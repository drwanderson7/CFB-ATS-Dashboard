"""
Vercel Python serverless function: POST /api/parse-pdf
Accepts a multipart/form-data PDF upload, returns JSON array of CFB games.
Each game: {away, home, bp, comp, homeVegas}
All spreads in home-team perspective (negative = home favored).
"""
from http.server import BaseHTTPRequestHandler
import json, re, io
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    pdfplumber = None


def parse_pdf_bytes(pdf_bytes: bytes) -> list:
    import pdfplumber, io, re
    from collections import defaultdict

    pdf = pdfplumber.open(io.BytesIO(pdf_bytes))

    def get_rows(page):
        h = page.height
        words = page.extract_words(keep_blank_chars=False)
        buckets = defaultdict(list)
        for w in words:
            y = round(h - w["top"])
            buckets[y].append(w)
        return {y: sorted(v, key=lambda x: x["x0"]) for y, v in buckets.items()}

    def nearest(row, target_x, tol=20):
        best, bd = None, 9999
        for w in row:
            d = abs(w["x0"] - target_x)
            if d < bd:
                bd, best = d, w
        return best["text"] if best and bd < tol else None

    def p_num(t):
        if t is None:
            return None
        t = str(t).strip().replace("+", "")
        if re.match(r"^pk", t, re.I):
            return 0.0
        try:
            return float(t)
        except ValueError:
            return None

    TV = {"ESPN","ESPN2","ESPN+","ESPNU","CBSSN","FS1","SECN","SECN+",
          "ACCN","BTN","TNT","CW","FOX","CBS","ABC","NBC","Prime"}

    # Page 2: schedule — Current@226.4, BP@273.4 (left); Current@502, BP@549 (right)
    BLOCKS2 = [
        {"lo": 0,   "hi": 300, "rX": 36.4,  "tlo": 50,  "thi": 145, "curX": 226.4, "bpX": 273.4},
        {"lo": 300, "hi": 620, "rX": 312.0, "tlo": 326, "thi": 420, "curX": 502.0, "bpX": 549.0},
    ]
    m2 = {}
    for _y, row in get_rows(pdf.pages[1]).items():
        for b in BLOCKS2:
            r = [w for w in row if b["lo"] <= w["x0"] < b["hi"]]
            if not r:
                continue
            rot_w = min(r, key=lambda w: abs(w["x0"] - b["rX"]))
            if abs(rot_w["x0"] - b["rX"]) > 5 or not re.match(r"^\d{3}$", rot_w["text"]):
                continue
            rot = int(rot_w["text"])
            team = " ".join(
                w["text"] for w in r
                if b["tlo"] <= w["x0"] < b["thi"]
                and re.search(r"[a-z]", w["text"], re.I)
                and w["text"] not in TV
                and ":" not in w["text"]
            )
            m2[rot] = {"team": team.strip(), "cur": p_num(nearest(r, b["curX"])), "bp": p_num(nearest(r, b["bpX"]))}

    # Page 6: computer lines — Comp@157 (left), Comp@338.8 (right)
    BLOCKS6 = [
        {"lo": 0,   "hi": 215, "rX": 36.0,  "compX": 157.0},
        {"lo": 215, "hi": 410, "rX": 217.8, "compX": 338.8},
    ]
    m6 = {}
    for _y, row in get_rows(pdf.pages[5]).items():
        for b in BLOCKS6:
            r = [w for w in row if b["lo"] <= w["x0"] < b["hi"]]
            if not r:
                continue
            rot_w = min(r, key=lambda w: abs(w["x0"] - b["rX"]))
            if abs(rot_w["x0"] - b["rX"]) > 5 or not re.match(r"^\d{3}$", rot_w["text"]):
                continue
            rot = int(rot_w["text"])
            comp = p_num(nearest(r, b["compX"]))
            if comp is not None:
                m6[rot] = {"comp": comp}

    # Pair games — CFB only (rot < 261), odd=away, even=home
    games = []
    for r in sorted(m2):
        if r >= 261 or r % 2 != 1 or r + 1 not in m2:
            continue
        a, h = m2[r], m2[r + 1]
        a_spread = a["cur"] is not None and a["cur"] <= 0.5
        h_spread = h["cur"] is not None and h["cur"] <= 0.5
        home_bp = home_vegas = None
        if a_spread and not h_spread:
            home_bp    = -a["bp"]  if a["bp"]  is not None else None
            home_vegas = -a["cur"] if a["cur"] is not None else None
        elif h_spread and not a_spread:
            home_bp    = h["bp"]
            home_vegas = h["cur"]
        elif a["cur"] is not None and h["cur"] is not None:
            if a["cur"] < h["cur"]:
                home_bp    = -a["bp"]  if a["bp"]  is not None else None
                home_vegas = -a["cur"]
            else:
                home_bp    = h["bp"]
                home_vegas = h["cur"]
        comp = m6.get(r + 1, {}).get("comp")
        if home_bp is not None and comp is not None and abs(home_bp - comp) > 14:
            home_bp = None
        games.append({"away": a["team"], "home": h["team"],
                      "bp": home_bp, "comp": comp, "homeVegas": home_vegas})
    return games


def parse_multipart(body: bytes, content_type: str):
    """Extract the first file from a multipart/form-data body."""
    boundary = None
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part[len("boundary="):].strip('"')
    if not boundary:
        return None
    sep = ("--" + boundary).encode()
    parts = body.split(sep)
    for part in parts[1:]:
        if b"\r\n\r\n" not in part:
            continue
        header_block, _, data = part.partition(b"\r\n\r\n")
        data = data.rstrip(b"\r\n--")
        if b"filename" in header_block:
            return data
    return None


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        ct = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if "multipart/form-data" in ct:
            pdf_bytes = parse_multipart(body, ct)
        else:
            pdf_bytes = body  # raw PDF body fallback

        if not pdf_bytes:
            self._respond(400, {"error": "No PDF received"})
            return

        try:
            games = parse_pdf_bytes(pdf_bytes)
            self._respond(200, games)
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)
