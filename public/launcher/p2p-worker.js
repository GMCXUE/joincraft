import {RtcEngine} from './p2p-engine.js';
const bridge=window.joincraftTransport;
const engine=new RtcEngine({emit:event=>bridge.event(event)});
bridge.onRequest(async request=>{
 try{bridge.reply({id:request.id,ok:true,value:await engine.command(request)});}
 catch(error){bridge.reply({id:request.id,ok:false,error:error.message||'直连操作失败'});}
});
