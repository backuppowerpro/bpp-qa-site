import{o as p,s as b,b as g}from"./ionic-app-BAfoYXvT.js";import"./manual-sms-operation-0e6b3zBP.js";import"./index-BJlF_jy9.js";/*!
 * (C) Ionic http://ionicframework.com - MIT License
 */const S=(n,u,X,f,w)=>{const s=n.ownerDocument.defaultView;let r=p(n);const l=t=>r?-t.deltaX:t.deltaX;return b({el:n,gestureName:"goback-swipe",gesturePriority:101,threshold:10,canStart:t=>(r=p(n),(e=>{const{startX:o}=e;return r?o>=s.innerWidth-50:o<=50})(t)&&u()),onStart:X,onMove:t=>{const e=l(t);f(e/s.innerWidth)},onEnd:t=>{const e=l(t),o=s.innerWidth,i=e/o,c=(a=>r?-a.velocityX:a.velocityX)(t),d=c>=0&&(c>.2||e>o/2),m=(d?1-i:i)*o;let h=0;if(m>5){const a=m/Math.abs(c);h=Math.min(a,540)}w(d,i<=0?.01:g(0,i,.9999),h)}})};export{S as createSwipeBackGesture};
//# sourceMappingURL=p-Sh0ICmPV-Caiq3umX.js.map
