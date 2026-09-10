'use strict';
const {app,BrowserWindow,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=process.env.BATTO_QA_DIR;if(!dir)throw new Error('BATTO_QA_DIR required');
app.setPath('userData',path.join(dir,'isolated-profile'));app.disableHardwareAcceleration();
let done=false;
function finish(ok,error){if(done)return;done=true;fs.writeFileSync(path.join(dir,'resume-result.json'),JSON.stringify({ok,error:error?.stack,version:app.getVersion(),checks:ok?['Independent process restart preserves broadcasts, deletions, volume, custom chat image, local chat/overlay icon, schema 6, native TikTok default and Originalansicht toggle']:[]}));ok?app.quit():app.exit(1);}
const timeout=setTimeout(()=>finish(false,new Error('Restart test timed out')),30000);timeout.unref();
app.whenReady().then(async()=>{
  try {
    const expected=JSON.parse(fs.readFileSync(path.join(dir,'resume-expectations.json')));
    let win,state;
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){
      win=BrowserWindow.getAllWindows()[0];
      if(win){
        try{state=await win.webContents.executeJavaScript(`typeof S!=='undefined'&&S.config?{config:S.config,assets:S.assets,view:S.view,chatActive:document.body.classList.contains('chat-background-active'),chatImage:getComputedStyle(document.querySelector('.chat-card')).backgroundImage}:null`);}catch{}
        if(state)break;
      }
      await new Promise(r=>setTimeout(r,100));
    }
    assert(state);
    assert.equal(app.getVersion(),'2.1.4');
    assert.equal(state.config.schemaVersion,expected.schemaVersion);
    assert.equal(state.config.autoBroadcast.items.length,expected.broadcasts);
    assert.equal(state.config.autoBroadcast.items[0].name,expected.broadcastName);
    assert.equal(state.config.tts.volume,expected.volume);
    assert.equal(state.config.platforms.tikfinity.webWidgets.some(widget=>widget.url===expected.tikfinityChatUrl),true);
    assert.equal(state.config.platforms.tikfinity.autoConnect,expected.tikfinityAutoConnect);
    const resumedNativeChat=await win.webContents.executeJavaScript(`(()=>{S.chatTab='tiktok';setView('dashboard');renderChat();return{view:S.tiktokChatView,native:!!document.querySelector('#tikfinityNativeState'),originalButton:!!document.querySelector('#tikfinityWidgetView'),frame:!!document.querySelector('#tikfinityChatFrame')}})()`);
    assert.deepEqual(resumedNativeChat,{view:'native',native:true,originalButton:true,frame:false});
    const resumedOriginalView=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#tikfinityWidgetView').click();const frame=document.querySelector('#tikfinityChatFrame');return frame?{view:S.tiktokChatView,src:frame.src,visible:frame.getBoundingClientRect().height>100,nativeButton:!!document.querySelector('#tikfinityNativeView')}:null})()`);
    assert.deepEqual(resumedOriginalView,{view:'widget',src:expected.tikfinityChatUrl,visible:true,nativeButton:true});
    const returnedNativeChat=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#tikfinityNativeView').click();return{view:S.tiktokChatView,native:!!document.querySelector('#tikfinityNativeState'),frame:!!document.querySelector('#tikfinityChatFrame')}})()`);
    assert.deepEqual(returnedNativeChat,{view:'native',native:true,frame:false});
    assert.equal(state.config.appearance.chatBackground.mode,'custom');
    assert.equal(state.config.appearance.chatBackground.customName,expected.chatBackgroundName);
    assert.equal(state.config.appearance.chatBackground.customPath,expected.chatBackgroundPath);
    assert.equal(fs.existsSync(expected.chatBackgroundPath),true);
    assert.equal(state.assets.chatBackground.mode,'custom');
    assert.equal(state.config.appearance.chatIcons.local.mode,'custom');
    assert.equal(state.config.appearance.chatIcons.local.customName,expected.localChatIconName);
    assert.equal(state.config.appearance.chatIcons.local.customPath,expected.localChatIconPath);
    assert.equal(fs.existsSync(expected.localChatIconPath),true);
    assert.deepEqual(nativeImage.createFromPath(expected.localChatIconPath).getSize(),{width:128,height:128});
    assert.equal(state.assets.localChatIcon.mode,'custom');
    assert.equal(state.assets.localChatIcon.width,128);
    assert.equal(state.assets.localChatIcon.height,128);
    assert.equal(state.chatActive,true);
    assert.match(state.chatImage,/chat-background-/);
    assert.equal(state.view,'start');
    clearTimeout(timeout);finish(true);
  } catch(e) { finish(false,e); }
});
