import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const chatPath = path.join(root, 'web-ui/src/pages/ChatPage.js');
const genChatPath = path.join(root, 'generated/public-web-ui/static/pages/ChatPage.js');
const interactionsPath = path.join(root, 'web-ui/src/features/chat/questions/interactions.js');
const genInteractionsPath = path.join(root, 'generated/public-web-ui/static/features/chat/questions/interactions.js');
const cssPath = path.join(root, 'web-ui/src/features/chat/rendering/css-escape.js');
const genCssPath = path.join(root, 'generated/public-web-ui/static/features/chat/rendering/css-escape.js');
const baselinePath = path.join(root, 'scripts/web-ui-architecture-baseline.json');

function quoted(s,i,q){for(let x=i+1;x<s.length;x++){if(s[x]==='\\'){x++;continue;}if(s[x]===q)return x;}throw new Error('unterminated string');}
function line(s,i){let x=i+2;while(x<s.length&&s[x]!=='\n')x++;return x;}
function block(s,i){const x=s.indexOf('*/',i+2);if(x<0)throw new Error('unterminated comment');return x+1;}
function templateExpr(s,i){let d=1;for(let x=i;x<s.length;x++){const c=s[x];if(c==="'"||c==='"'){x=quoted(s,x,c);continue;}if(c==='`'){x=template(s,x);continue;}if(c==='/'&&s[x+1]==='/'){x=line(s,x);continue;}if(c==='/'&&s[x+1]==='*'){x=block(s,x);continue;}if(c==='{')d++;else if(c==='}'&&--d===0)return x;}throw new Error('unterminated interpolation');}
function template(s,i){for(let x=i+1;x<s.length;x++){if(s[x]==='\\'){x++;continue;}if(s[x]==='`')return x;if(s[x]==='$'&&s[x+1]==='{')x=templateExpr(s,x+2);}throw new Error('unterminated template');}
function closing(s,i,open,close){let d=0;for(let x=i;x<s.length;x++){const c=s[x];if(c==="'"||c==='"'){x=quoted(s,x,c);continue;}if(c==='`'){x=template(s,x);continue;}if(c==='/'&&s[x+1]==='/'){x=line(s,x);continue;}if(c==='/'&&s[x+1]==='*'){x=block(s,x);continue;}if(c===open)d++;else if(c===close&&--d===0)return x;}throw new Error('unterminated range');}
function fn(s,name){const needle=`function ${name}(`;const start=s.indexOf(needle);assert.notEqual(start,-1,`${name} missing`);assert.equal(s.indexOf(needle,start+needle.length),-1,`${name} must be unique`);const op=s.indexOf('(',start+9+name.length);const cp=closing(s,op,'(',')');let bs=cp+1;while(/\s/.test(s[bs]))bs++;assert.equal(s[bs],'{');const be=closing(s,bs,'{','}');let end=be+1;while(s[end]==='\r'||s[end]==='\n')end++;return {name,start,end,text:s.slice(start,end)};}

const chat=fs.readFileSync(chatPath,'utf8');
assert.equal(chat,fs.readFileSync(genChatPath,'utf8'),'ChatPage mirrors must match');
const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const before=Buffer.byteLength(chat);
assert.equal(before,baseline.legacySurfaces['web-ui/src/pages/ChatPage.js'],'ChatPage must match ratchet');

const css=fn(chat,'cssEscapeValue');
const names=['toggleQuestionRadio','toggleQuestionOther','collectPrometheusQuestionAnswers','applyPrometheusQuestionComposerAnswer'];
const parts=names.map((name)=>fn(chat,name));
const extracted=parts.reduce((n,p)=>n+Buffer.byteLength(p.text),0)+Buffer.byteLength(css.text);
assert.ok(extracted>=2500&&extracted<=18000,`interaction extraction size ${extracted} is implausible`);

const cssSource=`/** Escape dynamic values used in CSS selectors. */\nexport ${css.text.trim()}\n`;
const interactionSource=`import { cssEscapeValue } from '../rendering/css-escape.js';\n\n/** DOM-only Prometheus Question interaction helpers. */\n${parts.map((p)=>`export ${p.text.trim()}`).join('\n\n')}\n`;
const ranges=[css,...parts].sort((a,b)=>b.start-a.start);
let next=chat;
for(const r of ranges) next=next.slice(0,r.start)+next.slice(r.end);
const anchor="import { renderInlinePrometheusQuestion } from '../features/chat/questions/QuestionCard.js';\n";
assert.equal(next.split(anchor).length,2,'QuestionCard import anchor must be unique');
next=next.replace(anchor,anchor+"import { applyPrometheusQuestionComposerAnswer, collectPrometheusQuestionAnswers, toggleQuestionOther, toggleQuestionRadio } from '../features/chat/questions/interactions.js';\nimport { cssEscapeValue } from '../features/chat/rendering/css-escape.js';\n");
for(const name of ['cssEscapeValue',...names]) assert.equal(next.includes(`function ${name}(`),false,`${name} declaration must move`);
for(const name of names) assert.ok((next.match(new RegExp(`${name}\\(`,'g'))||[]).length>=1,`${name} call sites must remain`);
assert.ok((next.match(/cssEscapeValue\(/g)||[]).length>=4,'shared cssEscapeValue call sites must remain');
const after=Buffer.byteLength(next);assert.ok(after<before,'ChatPage must shrink');
baseline.legacySurfaces['web-ui/src/pages/ChatPage.js']=after;
for(const [p,c] of [[interactionsPath,interactionSource],[genInteractionsPath,interactionSource],[cssPath,cssSource],[genCssPath,cssSource]]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c);}
fs.writeFileSync(chatPath,next);fs.writeFileSync(genChatPath,next);fs.writeFileSync(baselinePath,`${JSON.stringify(baseline,null,2)}\n`);
console.log(`Question interactions extracted: ${extracted} bytes; ChatPage ${before} -> ${after}`);

// Worker trigger revision 2.
