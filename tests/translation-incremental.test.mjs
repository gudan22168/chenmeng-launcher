import test from 'node:test'
import assert from 'node:assert/strict'
import {incrementalEntry,validateGlossary} from '../electron/translation-core.mjs'
test('incremental translation preserves known unchanged and legacy translations',()=>{
 assert.equal(incrementalEntry('Hello','k',{}, {k:'你好'},{k:'Hello'}),null)
 assert.equal(incrementalEntry('New','k',{}, {k:'旧译文'},{}),null)
 assert.deepEqual(incrementalEntry('New','k',{}, {k:'旧译文'},{k:'Old'}),{changed:true,previous:'旧译文'})
 assert.deepEqual(incrementalEntry('New','new',{}, {},{}),{changed:false,previous:null})
 assert.equal(incrementalEntry('New','k',{k:'内置译文'}, {k:'旧译文'},{k:'Old'}),null)
})
test('glossary is bounded and validated before any AI request',()=>{
 assert.deepEqual(validateGlossary([{source:'Mana',target:'魔力'}]),[{source:'Mana',target:'魔力'}])
 for(const invalid of [null,[null],[{source:'',target:'x'}],Array(201).fill({source:'a',target:'b'})])assert.throws(()=>validateGlossary(invalid))
})
