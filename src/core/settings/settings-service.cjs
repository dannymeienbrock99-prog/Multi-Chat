'use strict';
const { EventEmitter } = require('events');
const { deepMerge, DEFAULT_CONFIG } = require('../config-store.cjs');
const { validateConfig } = require('./schema.cjs');
class SettingsService extends EventEmitter {
  constructor({configStore}={}) {super();if(!configStore)throw new Error('SettingsService benötigt ConfigStore.');this.configStore=configStore;this.pending={};this.draft=configStore.get();this.dirty=false;}
  getPersisted(){return this.configStore.get();}
  getDraft(){this.draft=deepMerge(this.configStore.get(),this.pending);return structuredClone(this.draft);}
  isDirty(){return this.dirty;}
  syncIfClean(){if(!this.dirty)this.draft=this.configStore.get();}
  patch(patch={}){this.pending=deepMerge(this.pending,patch);const config=this.getDraft();this.dirty=JSON.stringify(config)!==JSON.stringify(this.configStore.get());const validation=validateConfig(config);this.emit('draft',{config,dirty:this.dirty,validation});return{config,dirty:this.dirty,validation};}
  apply(){const validation=validateConfig(this.getDraft());if(!validation.ok)return{ok:false,validation};const persisted=this.configStore.merge(this.pending);this.pending={};this.draft=persisted;this.dirty=false;this.emit('applied',persisted);return{ok:true,config:structuredClone(persisted)};}
  discard(){this.pending={};this.draft=this.configStore.get();this.dirty=false;this.emit('discarded',this.getDraft());return{ok:true,config:this.getDraft()};}
  resetSection(section){if(!(section in DEFAULT_CONFIG))return{ok:false,error:'Unbekannter Bereich.'};const result=this.patch({[section]:structuredClone(DEFAULT_CONFIG[section])});return{ok:result.validation.ok,...result};}
  test(section){const validation=validateConfig(this.getDraft());const errors=validation.errors.filter(x=>x.path===section||x.path.startsWith(section+'.'));return{ok:errors.length===0,errors};}
}
module.exports={SettingsService};
