const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require.resolve('../electron/main.js'),'utf8');
const block=source.slice(source.indexOf('const ownerWindow = mainWindow;'),source.indexOf('installSecureAccessOwnerCookie(ownerWindow).finally'));
let listener,shown=0; const mainWindow={webContents:{on:(ev,fn)=>{if(ev==='context-menu')listener=fn;}}};
const Menu={buildFromTemplate(items){assert.equal(items.length,1);assert.equal(items[0].role,'paste');return {popup:({window})=>{assert.equal(window,mainWindow);shown++;}};}};
vm.runInNewContext(block,{mainWindow,Menu}); assert.equal(typeof listener,'function');
for(const [kind,editable,canPaste] of [['input-text',true,true],['input-password',false,true],['input-password',true,false],['input-password',true,true]]) listener({}, {formControlType:kind,isEditable:editable,editFlags:{canPaste}});
assert.equal(shown,1); console.log('PASS native Paste only on editable password fields with paste available');
