// Keep the guide in SVG so the controller and its callouts stay sharp at any size.
const controllerArtwork = `
  <g class="pad-shell">
    <path class="pad-shoulder" d="M272 164 Q274 140 319 123 L345 116 Q362 111 384 126 L406 138 H554 L576 126 Q598 111 615 116 L641 123 Q686 140 688 164"/>
    <path class="pad-trigger" d="M301 142 L312 111 Q315 102 331 102 H357 Q371 103 375 120 L379 130 M581 130 L585 120 Q589 103 603 102 H629 Q645 102 648 111 L659 142"/>
    <path class="pad-body" d="M271 161 Q301 142 337 135 Q351 131 363 143 L412 195 Q420 204 435 204 H525 Q540 204 548 195 L597 143 Q609 131 623 135 Q659 142 689 161 C718 184 743 259 758 337 C768 385 763 423 728 439 Q707 443 666 389 L643 359 Q635 351 619 351 H341 Q325 351 317 359 L294 389 Q253 443 232 439 C197 423 192 385 202 337 C217 259 242 184 271 161 Z"/>
    <path class="pad-seam" d="M267 169 Q278 222 291 256 M693 169 Q682 222 669 256 M317 359 L292 322 M643 359 L668 322"/>
    <path class="pad-grip" d="M230 340 Q218 391 238 416 M730 340 Q742 391 722 416"/>
  </g>
  <g class="pad-hardware">
    <circle class="pad-stick-well" cx="349" cy="233" r="51"/>
    <circle class="pad-stick" cx="349" cy="233" r="35"/>
    <circle class="pad-stick-inner" cx="349" cy="233" r="24"/>
    <circle class="pad-stick-well" cx="559" cy="314" r="47"/>
    <circle class="pad-stick" cx="559" cy="314" r="33"/>
    <circle class="pad-stick-inner" cx="559" cy="314" r="23"/>
    <circle class="pad-dpad-well" cx="420" cy="310" r="43"/>
    <path class="pad-dpad" d="M408 278 H432 V298 H452 V322 H432 V342 H408 V322 H388 V298 H408 Z"/>
    <path class="pad-dpad-detail" d="M416 288 L420 284 L424 288 M416 332 L420 336 L424 332 M398 306 L394 310 L398 314 M442 306 L446 310 L442 314"/>
    <circle class="pad-menu-button" cx="449" cy="231" r="13"/>
    <path class="pad-menu-icon" d="M443 228 H450 V234 H443 Z M447 224 H454 V230"/>
    <circle class="pad-menu-button" cx="511" cy="231" r="13"/>
    <path class="pad-menu-icon" d="M505 227 H517 M505 231 H517 M505 235 H517"/>
    <circle class="pad-home" cx="480" cy="172" r="17"/>
    <path class="pad-home-mark" d="M471 180 L480 163 L489 180 M475 174 H485"/>
    <circle class="pad-face pad-face-y" cx="629" cy="210" r="21"/>
    <circle class="pad-face pad-face-x" cx="589" cy="250" r="21"/>
    <circle class="pad-face pad-face-b" cx="669" cy="250" r="21"/>
    <circle class="pad-face pad-face-a" cx="629" cy="290" r="21"/>
  </g>
  <g class="pad-button-letters" text-anchor="middle">
    <text x="339" y="122" class="pad-trigger-letter">LT</text>
    <text x="621" y="122" class="pad-trigger-letter">RT</text>
    <text x="629" y="218" class="pad-letter-y">Y</text>
    <text x="589" y="258" class="pad-letter-x">X</text>
    <text x="669" y="258" class="pad-letter-b">B</text>
    <text x="629" y="298" class="pad-letter-a">A</text>
  </g>`;

const controls = [
  {action: '刹车', key: 'LT / L2', detail: '模拟力度', x: 44, y: 62, line: '44,100 290,100 312,114', dot: [312,114]},
  {action: '油门', key: 'RT / R2', detail: '模拟力度', x: 916, y: 62, line: '916,100 670,100 648,114', dot: [648,114], right: true},
  {action: '转向', key: '左摇杆 / 十字键', x: 44, y: 211, line: '44,249 272,249 302,233', dot: [302,233]},
  {action: '回到起点', key: 'Y / △', x: 916, y: 143, line: '916,181 700,181 651,210', dot: [651,210], right: true},
  {action: '低速倒车', key: 'B / ○', x: 916, y: 224, line: '916,262 734,262 691,250', dot: [691,250], right: true},
  {action: '切换视角', key: 'X / □', x: 916, y: 305, line: '916,343 723,343 589,293 589,272', dot: [589,272], right: true},
  {action: '手刹 / 确认', key: 'A / ×', detail: '上车、继续', x: 916, y: 386, line: '916,424 704,424 641,309', dot: [641,309], right: true},
  {action: '返回工坊', key: 'Back / Share', x: 268, y: 491, line: '268,462 353,462 449,385 449,245', dot: [449,245]},
  {action: '开始 / 暂停', key: 'Start / Options', x: 692, y: 491, line: '692,462 607,462 511,385 511,245', dot: [511,245], right: true},
];

export const gamepadGuide = `
<section class="gamepad-guide" aria-label="手柄控制图示">
  <div class="gamepad-guide-heading"><h3>手柄控制</h3><span>Xbox / PlayStation · 标准映射</span></div>
  <figure class="gamepad-figure">
    <svg class="gamepad-diagram" viewBox="0 0 960 540" role="img" aria-labelledby="pad-guide-title pad-guide-desc">
      <title id="pad-guide-title">手柄按键与驾驶操作</title>
      <desc id="pad-guide-desc">左摇杆或十字键转向；LT / L2 刹车；RT / R2 油门；Y / △ 回到起点；X / □ 切换视角；B / ○ 低速倒车；A / × 上车、继续或卡丁车手刹；Back / Share 返回工坊；Start / Options 开始或暂停。</desc>
      ${controllerArtwork}
      <g class="pad-callout-lines">
        <polyline points="272,249 308,310 387,310"/>
        <circle cx="387" cy="310" r="3"/>
        ${controls.map(c=>`<polyline points="${c.line}"/><circle cx="${c.dot[0]}" cy="${c.dot[1]}" r="3"/>`).join('')}
      </g>
      ${controls.map(c=>`<g class="pad-callout" text-anchor="${c.right?'end':'start'}"><text class="pad-callout-action" x="${c.x}" y="${c.y}">${c.action}</text><text class="pad-callout-key" x="${c.x}" y="${c.y+23}">${c.key}${c.detail?`<tspan class="pad-callout-detail"> · ${c.detail}</tspan>`:''}</text></g>`).join('')}
    </svg>
    <svg class="gamepad-diagram-mobile" viewBox="186 96 588 355" aria-hidden="true">${controllerArtwork}</svg>
    <dl class="gamepad-mobile-controls">
      ${controls.map(c=>`<div${c.action==='转向'?' class="pad-control-steering"':''}><dt>${c.key}</dt><dd>${c.action}${c.action==='手刹 / 确认'?'<small>上车、继续</small>':''}</dd></div>`).join('')}
    </dl>
    <figcaption><span class="pad-connect-dot" aria-hidden="true"></span>连接后按任意键识别，再松开摇杆与扳机。<span class="pad-handbrake-note">手刹仅适用于卡丁车。</span></figcaption>
  </figure>
</section>`;
