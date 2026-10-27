import React from 'react';
import type {Project} from './project';
import {saveProject} from './storage';

// Reference-only checkpoint: never duplicate the base64 image payload per move.
let checkpoint:Project|undefined,canPersist=false;
export function rememberCanvas(project:Project,persist:boolean){checkpoint=project;canPersist=persist;}
export class CanvasRecovery extends React.Component<{initial:Project;loadError:string;children:(p:Project,error:string)=>React.ReactNode},{failed:boolean;saveState:string;epoch:number}> {
  state={failed:false,saveState:'',epoch:0};
  reporting=false;
  static getDerivedStateFromError(){return {failed:true};}
  report=(error?:unknown)=>{
    if(this.reporting)return;this.reporting=true;
    this.setState({failed:true,saveState:'画布运行异常，正在尝试保存最新内存状态…'});
    try{sessionStorage.setItem('zhongxing-last-failure',new Date().toISOString());}catch{}
    if(checkpoint&&canPersist)void saveProject({...checkpoint,savedAt:new Date().toISOString()}).then(()=>this.setState({saveState:'最新内存状态已保存，可恢复画布。'}),()=>this.setState({saveState:'本次紧急保存未确认。可先恢复内存画布并导出；重载只能读取上次已落盘状态。'}));
    else this.setState({saveState:'没有可安全写入的新状态。原记录未覆盖，重载将读取上次保存内容。'});
    console.warn('Canvas recovery activated',error instanceof Error?error.name:'runtime');
  };
  componentDidCatch(error:Error){this.report(error);}
  onError=(event:ErrorEvent)=>{if(event.error)this.report(event.error);};
  onContextLost=()=>this.report(new Error('Canvas context lost'));
  onRejection=(event:PromiseRejectionEvent)=>this.report(event.reason);
  componentDidMount(){window.addEventListener('error',this.onError);window.addEventListener('unhandledrejection',this.onRejection);document.addEventListener('contextlost',this.onContextLost,true);}
  componentWillUnmount(){window.removeEventListener('error',this.onError);window.removeEventListener('unhandledrejection',this.onRejection);document.removeEventListener('contextlost',this.onContextLost,true);}
  render(){if(this.state.failed)return <main className="canvas-recovery" role="alert"><h1>画布遇到异常</h1><p>{this.state.saveState||'编辑器渲染失败，原项目未删除。'}</p><p>恢复将重新挂载编辑器；刷新只能恢复已保存内容。整个宿主渲染进程退出时，此提示也无法显示。</p><button onClick={()=>{this.reporting=false;this.setState(s=>({failed:false,epoch:s.epoch+1,saveState:''}));}}>恢复内存画布</button><button onClick={()=>location.reload()}>重新加载已保存项目</button></main>;
    return <React.Fragment key={this.state.epoch}>{this.props.children(checkpoint||this.props.initial,this.state.epoch?'已从内存恢复，请先核对画布或导出备份，再恢复自动保存。':this.props.loadError)}</React.Fragment>;
  }
}
