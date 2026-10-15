import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
/** Without JS/hydration the browser submits a native form as GET unless method is explicit. */
test('account forms containing password controls never fall back to credentials in a GET query',()=>{
 const dir=join(process.cwd(),'src/components/account'),bad:string[]=[];
 const attr=(node:ts.JsxOpeningElement|ts.JsxSelfClosingElement,name:string)=>node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText()===name) as ts.JsxAttribute|undefined;
 const value=(node:ts.JsxAttribute|undefined)=>node?.initializer&&ts.isStringLiteral(node.initializer)?node.initializer.text:'';
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.tsx'))){
  const source=ts.createSourceFile(file,readFileSync(join(dir,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const walk=(node:ts.Node)=>{
   if(ts.isJsxElement(node)&&node.openingElement.tagName.getText()==='form'){
    let password=false;const scan=(n:ts.Node)=>{if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText()==='input'&&value(attr(n,'type'))==='password')password=true;ts.forEachChild(n,scan);};scan(node);
    if(password&&value(attr(node.openingElement,'method')).toLowerCase()!=='post')bad.push(file+':'+(source.getLineAndCharacterOfPosition(node.pos).line+1));
   }
   ts.forEachChild(node,walk);
  };walk(source);
 }
 assert.deepEqual(bad,[],'native password forms must use POST even before hydration');
});
