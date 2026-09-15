const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const matching = html.slice(html.indexOf('  var STOPWORDS = {};'), html.indexOf('  // Coverage accounting'));
const manual = html.slice(html.indexOf('  // Manual advances cannot skip'), html.indexOf('  function updateQRail(draft)'));
const bank = JSON.parse(html.match(/<script id="app-state"[^>]*>([\s\S]*?)<\/script>/)[1]).questions;
function engine() {
  const ctx = {state:{questions:bank}, toast(){}, updateQRail(){}};
  vm.createContext(ctx);
  vm.runInContext(matching + manual, ctx);
  return ctx;
}
function transcript(choice = 4) {
  return [1,2,3,choice,6,7,8,9].map(n => bank[n-1].text + ' Answer marker ' + n + '.');
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('all inline JavaScript parses', () => {
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes('application/json') && m[2].trim()) new vm.Script(m[2]);
  }
});

for (const choice of [4,5]) {
  test('complete interview choosing question ' + choice, () => {
    const ctx = engine();
    const r = ctx.runMatching(transcript(choice),bank,[]);
    assert.equal(r.currentQuestionId,bank[8].id);
    assert.deepEqual(plain(r.qa.map(q=>q.asked)), [true,true,true,choice===4,choice===5,true,true,true,true]);
    r.qa.forEach((q,i) => assert.equal(q.answerText, q.asked ? 'Answer marker '+(i+1)+'.' : ''));
    assert.equal(r.qa[3].group,r.qa[4].group);
    assert.ok(r.qa[3].group);
  });
}

test('answer keywords and later questions never skip the required next question', () => {
  const ctx=engine();
  const speech=[bank[0].text, 'My strengths are teamwork and I ask for help. Do you have any questions for us?', bank[2].text];
  const r=ctx.runMatching(speech,bank,[]);
  assert.equal(r.currentQuestionId,bank[0].id);
  assert.equal(r.qa.filter(q=>q.asked).length,1);
  assert.ok(r.qa[0].answerText.includes('My strengths'));
});

test('a weakness answer stays under 4 and commitment can follow without 5', () => {
  const ctx=engine();
  const speech=transcript(4).slice(0,4).concat([
    'My biggest weakness is not asking for help. I now ask my teammates for advice.',
    'How will you remain involved in prioritize to me throughout your college experience',
    'I set aside time every week.'
  ]);
  const r=ctx.runMatching(speech,bank,[]);
  assert.equal(r.currentQuestionId,bank[5].id);
  assert.ok(r.qa[3].answerText.includes('My biggest weakness'));
  assert.equal(r.qa[5].answerText,'I set aside time every week.');
  assert.equal(r.qa[4].asked,false);
  assert.equal(r.qa[8].asked,false);
});

test('a prompt split across speech results is detected without losing its answer', () => {
  const ctx=engine();
  const speech=[bank[0].text,'My introduction. So why are you interested', 'in joining to me and why should to me be interested in you? I enjoy learning.'];
  const r=ctx.runMatching(speech,bank,[]);
  assert.ok(r.qa[0].answerText.includes('My introduction.'));
  assert.equal(r.qa[1].answerText,'I enjoy learning.');
  assert.equal(r.currentQuestionId,bank[1].id);
});

test('questions and answers in a single unpunctuated speech result retain their boundaries', () => {
  const ctx=engine();
  const input=transcript(5).join(' ').replace(/[?.]/g,'');
  const r=ctx.runMatching([input],bank,[]);
  for(const n of [1,2,3,5,6,7,8,9]) assert.equal(r.qa[n-1].answerText,'Answer marker '+n);
});

test('repeated earlier prompts cannot move the interview backwards', () => {
  const ctx=engine();
  const r=ctx.runMatching(transcript(4).slice(0,4).concat([bank[0].text,bank[4].text,'More detail.']),bank,[]);
  assert.equal(r.currentQuestionId,bank[3].id);
  assert.equal(r.qa[4].asked,false);
  assert.ok(r.qa[3].answerText.includes('More detail.'));
});

test('confirmation wording recognizes meetings before the closing question', () => {
  const ctx=engine();
  const r=ctx.runMatching(transcript(4).slice(0,6).concat([
    'You mentioned this already but you can make the meetings at 5:30 on Mondays right okay and lastly do you have any questions for us',
    'How do projects get assigned?'
  ]),bank,[]);
  assert.equal(r.currentQuestionId,bank[8].id);
  assert.equal(r.qa[7].asked,true);
  assert.equal(r.qa[8].answerText,'How do projects get assigned?');
});

test('manual next requires the choice and then bypasses its unchosen sibling', () => {
  const ctx=engine();
  ctx.recSession={utterances:[],jumps:[]};
  for(let i=0;i<3;i++) ctx.skipToNextQuestion();
  assert.equal(ctx.recSession.draft.currentQuestionId,bank[2].id);
  ctx.skipToNextQuestion();
  assert.equal(ctx.recSession.draft.currentQuestionId,bank[2].id);
  ctx.jumpToQuestion(bank[4].id);
  assert.equal(ctx.recSession.draft.currentQuestionId,bank[4].id);
  ctx.skipToNextQuestion();
  assert.equal(ctx.recSession.draft.currentQuestionId,bank[5].id);
  ctx.jumpToQuestion(bank[8].id);
  ctx.jumpToQuestion(bank[0].id);
  assert.equal(ctx.recSession.draft.currentQuestionId,bank[5].id);
});

test('manual boundary keeps earlier text with the preceding question', () => {
  const ctx=engine();
  const r=ctx.runMatching(['First answer.','Second answer.'],bank,[{at:0,questionId:bank[0].id},{at:1,questionId:bank[1].id}]);
  assert.equal(r.qa[0].answerText,'First answer.');
  assert.equal(r.qa[1].answerText,'Second answer.');
});

test('TAMID corrections still preserve ordinary to-me phrases', () => {
  const ctx=engine();
  assert.equal(ctx.applyWordCorrections('Why join to me?'),'Why join TAMID?');
  assert.equal(ctx.applyWordCorrections('Learning is important to me.'),'Learning is important to me.');
});
