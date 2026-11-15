export function mountDiagnostics({api,onError=()=>{}}){
 const $=s=>document.querySelector(s),node=(tag,text,className)=>{const el=document.createElement(tag);el.textContent=text??'';if(className)el.className=className;return el;};
 let id=null,report=null,busy=false,sequence=0,errorNote='',attempted=false;
 function render(){
  $('#diagnostics-refresh').disabled=!id||!api?.diagnostics||busy;
  $('#diagnostics-export').disabled=!report||busy||!api?.exportDiagnostics;
  $('#diagnostics-panel').setAttribute('aria-busy',String(busy));
  $('#diagnostics-summary').textContent=busy?'正在检查本次启动输出与游戏日志…':errorNote||report?.summary||'启动或联机失败后，在这里查看可能原因和处理建议。';
  const findings=$('#diagnostics-findings');findings.replaceChildren();
  for(const finding of report?.findings||[]){const section=node('section',null,'diagnostic-finding');section.append(node('h4',finding.title),node('p',finding.suggestion),node('code',finding.evidence));findings.append(section);}
  const logs=$('#diagnostics-sources'),expanded=new Set([...logs.querySelectorAll('details[open]')].map(el=>el.dataset.source));logs.replaceChildren();
  for(const source of report?.sources||[]){const details=node('details'),summary=node('summary',source.name+(source.truncated?' · 日志末尾片段':'')),pre=node('pre',source.text.slice(-20000));details.dataset.source=source.name;details.open=expanded.has(source.name);details.append(summary,pre);if(source.text.length>20000)details.append(node('p','界面仅显示末尾片段；导出报告可查看本次收集的内容。'));logs.append(details);}
  $('#diagnostics-warnings').textContent=(report?.warnings||[]).join(' ');
 }
 async function load(instance,{force=false}={}){
  const next=instance?.id||null;if(next!==id){id=next;sequence++;report=null;busy=false;attempted=false;errorNote='';render();}
  if(!id||!api?.diagnostics||busy||attempted&&!force)return;
  const request=++sequence,target=id;busy=true;attempted=true;errorNote='';render();
  try{const value=await api.diagnostics({id:target});if(request===sequence&&target===id)report=value;}
  catch(error){if(request===sequence){errorNote='日志检查失败，请重试。';onError(error);}}
  finally{if(request===sequence){busy=false;render();}}
 }
 $('#diagnostics-refresh').onclick=()=>load({id},{force:true});
 $('#diagnostics-export').onclick=async()=>{if(!report||busy)return;const request=++sequence,target=id;busy=true;render();try{const result=await api.exportDiagnostics({id:target});if(request===sequence&&result?.saved)$('#diagnostics-export-state').textContent='诊断报告已保存';}catch(error){if(request===sequence)onError(error);}finally{if(request===sequence){busy=false;render();}}};
 render();return {load,reset(instance){if(instance?.id!==id){id=instance?.id||null;sequence++;report=null;busy=false;attempted=false;errorNote='';$('#diagnostics-export-state').textContent='';render();}}};
}
