import fs from 'node:fs';

const html=fs.readFileSync(new URL('../app/index.html',import.meta.url),'utf8');
const icons=fs.readFileSync(new URL('../app/js/icons.js',import.meta.url),'utf8');
const pools=fs.readFileSync(new URL('../app/js/pool-contexts.js',import.meta.url),'utf8');
const confidence=fs.readFileSync(new URL('../app/js/confidence-integration.js',import.meta.url),'utf8');
const survivor=fs.readFileSync(new URL('../app/js/survivor-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css',import.meta.url),'utf8');

let failures=0;
function check(name,cond){console.log(`[${cond?'PASS':'FAIL'}] ${name}`);if(!cond)failures++;}

check('app owns an inline SVG icon sprite',html.includes('class="pg-icon-sprite"')&&html.includes('id="pg-icon-message"')&&html.includes('id="pg-icon-lock"'));
check('dynamic renderers have a shared pgIcon helper',/function pgIcon\(name, className=""\)/.test(icons));
check('header Feedback Account Settings no longer use emoji glyphs',!html.includes('>💬<')&&!html.includes('>👤<')&&!html.includes('>⚙<')&&html.includes('#pg-icon-message')&&html.includes('#pg-icon-user')&&html.includes('#pg-icon-sliders'));
check('sign-in feature cards use SVG icons',html.includes('signin-feature-icon')&&!html.includes('>📊<')&&!html.includes('>🔑<')&&!html.includes('>🏆<')&&!html.includes('>📈<'));
check('legacy colorful emoji are absent from user-facing app markup',![...'📊🏆📈👤💬🔑⚙✨🎯🔒🗑'].some(ch=>html.includes(ch)));
check('shared icon styling exists',css.includes('.pg-icon{')&&css.includes('stroke:currentColor'));

check('ATS pool onboarding has four primary journey steps',html.includes('id="poolSettingsCreateBtn"')&&html.includes('id="poolSettingsWeekBtn"')&&html.includes('id="poolSettingsPicksBtn"')&&html.includes('id="poolSettingsResultsBtn"'));
check('ATS entry management is secondary to the four-step journey',html.includes('class="pool-settings-admin-row"')&&html.includes('id="poolSettingsEntriesBtn"'));
check('ATS renderer computes state for slate picks and results',pools.includes('const picksComplete=')&&pools.includes('const hasHistory=')&&pools.includes('setStep(resultsBtn'));
check('Confidence has the same four-step journey',/function cpJourneyHTML\(/.test(confidence)&&confidence.includes('"Create pool"')&&confidence.includes('"Add weekly slate"')&&confidence.includes('"Make picks"')&&confidence.includes('"Track results"'));
check('Confidence journey actions route to setup picks and results',confidence.includes('[data-cp-journey]')&&confidence.includes('cpSetSubview(pool,"results")'));
check('Survivor has an equivalent four-step journey',/function pgSurvivorRenderJourney\(/.test(survivor)&&survivor.includes("'Choose pool'")&&survivor.includes("'Load schedule'")&&survivor.includes("'Make picks'")&&survivor.includes("'Track survival'"));
check('Survivor journey is rendered from live pool/week/pick state',survivor.includes('pgSurvivorRenderJourney();')&&survivor.includes('selected.length>=required'));
check('pool journey has shared responsive styling',css.includes('.pool-onboarding{display:grid;grid-template-columns:repeat(4')&&css.includes('.pool-onboarding-step.is-current'));

if(failures)process.exit(1);
console.log('P1 icon + pool onboarding contract passed.');
