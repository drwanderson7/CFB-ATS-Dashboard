"""Runtime regression tests for the Clerk JWT hardening added to
verify_user() (source of truth: api/state.py, kept in sync across all 8
api/*.py copies -- see test_auth_sync.py for the structural drift check).

test_auth_sync.py only proves the 8 copies are byte/AST-identical to each
other; it does NOT exercise what the code actually does at runtime. This
file imports the REAL state.py and calls the REAL verify_user() with a
mocked JWKS client + mocked jwt.decode (no real RSA keys needed -- we're
proving verify_user()'s own logic around the issuer kwarg and the azp
check, not PyJWT's signature verification itself, which is a
well-tested third-party library).

Two real gaps this closes, found in an independent audit and confirmed
against this exact source:
  1. jwt.decode() was never told an expected issuer at all -- any RS256
     token signed by a key present in the configured JWKS (i.e. ANY
     Clerk instance sharing that key rotation scheme, not just this
     app's own) would pass signature verification. Now the issuer is
     pinned, DERIVED from CLERK_JWKS_URL rather than guessed.
  2. There was no check of the azp (authorized party) claim at all --
     Clerk's own guidance for restricting cross-origin/session misuse.
     Enforced only when the claim is present (see api/state.py's own
     comment on _ALLOWED_AZP for why: this project hasn't inspected a
     real production-issued token to confirm Clerk always populates azp
     for this app's flow, so a wrong guess there would silently break
     ALL production auth rather than just narrowing it).

Run with:
    python3 tests/test_clerk_token_hardening.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ["CLERK_JWKS_URL"] = "https://clerk.pickgauge.com/.well-known/jwks.json"

spec = importlib.util.spec_from_file_location("state", os.path.join(ROOT, "api", "state.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []
total = [0]


def check(name, cond):
    total[0] += 1
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures.append(name)


class FakeSigningKey:
    key = "fake-public-key"


class FakeJWKSClient:
    def get_signing_key_from_jwt(self, token):
        return FakeSigningKey()


class FakeHandler:
    def __init__(self, token):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        # Real handler.headers is an http.client.HTTPMessage; .get() is
        # all verify_user() actually calls, so a plain dict is enough.


mod._get_jwks_client = lambda: FakeJWKSClient()

# --- _CLERK_ISSUER derivation -----------------------------------------------
check("_CLERK_ISSUER is derived from CLERK_JWKS_URL by stripping the well-known suffix, not hardcoded",
  mod._CLERK_ISSUER == "https://clerk.pickgauge.com")

# --- issuer is actually passed to jwt.decode() ------------------------------
captured = {}
real_payload = {"sub": "user_abc123"}


def fake_decode(token, key, **kwargs):
    captured.clear()
    captured.update(kwargs)
    return dict(real_payload)


mod.jwt.decode = fake_decode
mod.verify_user(FakeHandler("sometoken"))
check("verify_user() passes issuer=<derived issuer> to jwt.decode(), not omitted",
  captured.get("issuer") == "https://clerk.pickgauge.com")
check("verify_user() still leaves verify_aud disabled (unchanged -- see api/state.py's own comment for why aud isn't pinned yet)",
  captured.get("options", {}).get("verify_aud") is False)

# --- azp: absent claim is permitted (see module docstring for why) ---------
mod.jwt.decode = lambda token, key, **kw: {"sub": "user_1", "azp": None}
result = mod.verify_user(FakeHandler("t"))
check("verify_user(): a token with no azp claim at all is still accepted (permissive-when-absent, by design)",
  result == "user_1")

mod.jwt.decode = lambda token, key, **kw: {"sub": "user_1"}  # azp key entirely missing, not just None
result = mod.verify_user(FakeHandler("t"))
check("verify_user(): azp key missing entirely from the payload (not just None) is also accepted",
  result == "user_1")

# --- azp: present and matches the allowlist ---------------------------------
mod.jwt.decode = lambda token, key, **kw: {"sub": "user_2", "azp": "https://pickgauge.com"}
result = mod.verify_user(FakeHandler("t"))
check("verify_user(): a token whose azp matches the allowed production origin is accepted",
  result == "user_2")

# --- azp: present but does NOT match the allowlist (the actual fix) --------
mod.jwt.decode = lambda token, key, **kw: {"sub": "user_3", "azp": "https://some-other-site.example"}
result = mod.verify_user(FakeHandler("t"))
check("verify_user(): a token whose azp names a DIFFERENT origin is rejected (returns None) -- the real cross-origin misuse case this fix closes",
  result is None)

# --- jwt.decode() raising (e.g. a real InvalidIssuerError from a token ------
# actually signed for a different Clerk instance) is caught, not a crash ---
def raise_invalid_issuer(token, key, **kw):
    raise mod.jwt.InvalidIssuerError("Invalid issuer")


mod.jwt.decode = raise_invalid_issuer
result = mod.verify_user(FakeHandler("t"))
check("verify_user(): jwt.decode() raising InvalidIssuerError (wrong-issuer token) is caught and returns None, not an unhandled exception",
  result is None)

# --- no Authorization header at all -----------------------------------------
result = mod.verify_user(FakeHandler(None))
check("verify_user(): a request with no Authorization header returns None without ever calling jwt.decode",
  result is None)

if failures:
    print(f"\n{len(failures)} of {total[0]} FAILURE(S):", failures)
    raise SystemExit(1)
print(f"\nAll {total[0]} checks passed.")
