import {voiceLevel} from './voice-levels.js';
// SDK track processor: capture -> gain -> outgoing MediaStream. Never connects
// the microphone to the local speakers, and never owns/stops the raw input.
export class MicrophoneGain {
 name='joincraft-microphone-gain';
 constructor(value=1){this.value=voiceLevel(value);}
 set(value){this.value=voiceLevel(value);const context=this.context;if(this.gain&&context){this.gain.gain.cancelScheduledValues(context.currentTime);this.gain.gain.setTargetAtTime(this.value,context.currentTime,.015);}return this.value;}
 async init({track,audioContext}){
  await this.destroy();
  if(!audioContext||audioContext.state==='closed')throw Error('当前环境无法调整麦克风音量，请更新浏览器或客户端');
  this.context=audioContext;
  try{this.source=audioContext.createMediaStreamSource(new MediaStream([track]));this.gain=audioContext.createGain();this.gain.gain.value=this.value;this.destination=audioContext.createMediaStreamDestination();this.source.connect(this.gain);this.gain.connect(this.destination);this.processedTrack=this.destination.stream.getAudioTracks()[0];
   if(!this.processedTrack)throw Error('无法创建麦克风音量处理轨道');await audioContext.resume();
  }catch(error){await this.destroy();throw error;}
 }
 async restart(options){await this.init(options);}
 async destroy(){this.source?.disconnect();this.gain?.disconnect();this.destination?.disconnect();this.processedTrack?.stop();this.source=this.gain=this.destination=this.processedTrack=this.context=undefined;}
}
