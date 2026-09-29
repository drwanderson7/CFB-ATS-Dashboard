// Fast source guards for review items 8 & 9 (Sept 23, 2026). Browser proof:
// tests/test_e2e_buttons_header.py.
// Run with:  node tests/test_buttons_header_css.mjs
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("../app/css/app.css"), html = read("../app/index.html"), init = read("../app/js/init.js"), beta = read("../app/js/beta.js");
let fail = 0, total = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) fail++; };

const polish = css.indexOf(".btn{border:1px solid transparent;");
const restore = css.indexOf(".btn.btn-light{border-color:#D4D4D8;}");
check("secondary-button outline restore exists", restore > 0);
check("...and comes AFTER the transparent-border polish rule (so it wins)", polish > 0 && restore > polish);
check("btn-secondary outline restored too", css.includes(".btn.btn-secondary{border-color:#71717A;}"));

const phone = css.slice(css.indexOf("/* Phone header on ONE row (Sept 23, 2026)."));
check("phone header block exists", phone.includes("@media(max-width:720px){"));
check("phone header: no wrap", phone.includes("header.app .app-top{flex-wrap:nowrap;"));
check("phone header: Feedback button hidden", phone.includes("header.app #feedbackBtn{display:none;}"));
check("phone header: Refresh icon-only 44px", phone.includes("header.app #refreshBtn.header-refresh{width:44px;min-width:44px;height:44px;"));
check("phone header: CFB ATS tag hidden", phone.includes("header.app .brand .wk{display:none;}"));
check("reduced-motion respected for the refresh spinner", css.includes("@media (prefers-reduced-motion:reduce){header.app #refreshBtn.header-refresh:disabled::before{animation:none;}}"));

check("phone menu has a 'Send feedback' item", html.includes('<button type="button" class="nav-feedback-mobile" id="navFeedbackBtn">Send feedback</button>'));
check("menu item hidden on desktop, shown on phones", css.includes("nav.tabs .nav-feedback-mobile{display:none;}") && css.includes("nav.tabs .nav-feedback-mobile{display:block;"));
check("menu item opens feedback and closes the menu", beta.includes("navFb.onclick=()=>{ if(typeof closeNavHamburger==='function') closeNavHamburger(); openBetaFeedback('nav'); };"));
check("tab wiring limited to real tabs ([data-tab]) so the menu item isn't hijacked", init.includes('document.querySelectorAll("nav.tabs button[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));'));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
