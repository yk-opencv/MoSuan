import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openSettings, openSidebar } from './helpers/navigation';

test('phone requests return raw native API answers without opening any chat page or computer API', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any; w.CapacitorCustomPlatform = { name: 'android' }; w.__asks = []; w.__cancels = []; w.__hold = false;
    const cancelled = new Set<string>();
    w.Capacitor = {
      PluginHeaders: [{ name: 'MosuanWeb', methods: ['status','open','ask','cancel','proof','forget','removeListener'].map(name=>({name,rtype:'promise'})).concat([{name:'addListener',rtype:'callback'}]) }],
      nativeCallback: (_plugin: string, _method: string, _options: any, callback: any) => { w.__webCallback=callback; return 'mock-callback'; },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (method==='status') return {available:true,ready:localStorage.getItem('mock-phone-login')==='ready',direct:true};
        if (method==='open') { localStorage.setItem('mock-phone-login','ready'); localStorage.setItem('mock-open-count',String(Number(localStorage.getItem('mock-open-count')||0)+1)); return {}; }
        if (method==='forget') { localStorage.removeItem('mock-phone-login'); return {}; }
        if (method==='cancel') { cancelled.add(options.id); w.__cancels.push(options); return {}; }
        if (method==='ask') {
          w.__asks.push(options);
          const deliver=(event:any)=>{if(!cancelled.has(options.id))w.__webCallback({id:options.id,...event});};
          const raw=(event:any)=>({kind:'raw',content:`data: ${JSON.stringify(event)}\n\n`});
          setTimeout(()=>deliver({kind:'progress',message:'正在接收 DeepSeek 回答…'}),20);
          setTimeout(()=>deliver(raw({p:'response/content',v:'手机直连：$$\\int_0^1 x\\,dx='})),120);
          if(!w.__hold)setTimeout(()=>{deliver(raw({p:'response/content',v:'\\frac{1}{2}$$'}));deliver(raw({p:'response/status',v:'FINISHED'}));deliver({kind:'end'});},350);
        }
        return {};
      },
    };
  });
  const computerRequests:string[]=[];
  await page.route('**/api/**',route=>{computerRequests.push(route.request().url());return route.abort();});
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await expect(page.locator('.katex').first()).toBeVisible(); await openSettings(page,'API 与连接');
  await expect(page.getByRole('group',{name:'手机连接方式',exact:true}).getByRole('button',{name:/^手机网页直连/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('电脑服务地址',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'登录 / 打开 DeepSeek',exact:true}).click();
  await expect(page.locator('.connection-status')).toContainText('已保存');
  await page.screenshot({path:'artifacts/verification/phone-direct-settings-mobile.png'});
  await page.getByRole('button',{name:'关闭窗口'}).click(); await openSidebar(page);
  await page.getByRole('button',{name:'新的学习对话'}).click();
  const picture = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 150; const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, 300, 150); context.fillStyle = 'black'; context.font = '32px serif'; context.fillText('1 + 1 = ?', 30, 80); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.getByLabel('选择题目图片').setInputFiles(Array.from({ length: 8 }, (_, i) => ({ name: '手机题目' + (i + 1) + '.png', mimeType: 'image/png', buffer: picture })));
  await expect(page.getByRole('alert')).toContainText('最多 7 张');
  await expect(page.getByRole('button', { name: /^移除图片：手机题目/ })).toHaveCount(7);
  await expect(page.getByRole('button', { name: '上传图片', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '关闭提示' }).click();
  await page.getByLabel('输入问题').fill('推导这个积分，不使用网页按钮'); await page.getByRole('button',{name:'发送问题'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__asks.length)).toBe(1);
  const payload = await page.evaluate(() => (window as any).__asks[0]);
  expect(payload.images).toHaveLength(7);
  expect(payload.images.every((image: { dataUrl: string }) => image.dataUrl.startsWith('data:image/jpeg;base64,'))).toBe(true);
  expect(payload.prompt).toContain('[附件 7：手机题目7.png]');
  await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('mock-open-count'))).toBe('1');
  await page.getByRole('button',{name:'跳到末尾'}).click(); await expect(page.locator('.katex-display')).toBeVisible();
  await page.reload(); await page.getByRole('button',{name:'跳到末尾'}).click(); await expect(page.locator('.katex-display')).toBeVisible();
  await expect(page.locator('.message-images img')).toHaveCount(7);
  await expect(page.locator('.composer-model')).toContainText('手机网页直连');
  await page.evaluate(()=>{(window as any).__hold=true;});
  await page.getByLabel('输入问题').fill('下一步'); await page.getByRole('button',{name:'发送问题'}).click();
  await expect(page.getByRole('button',{name:'停止生成'})).toBeVisible();
  await page.getByRole('button',{name:'停止生成'}).click(); await expect.poll(()=>page.evaluate(()=>(window as any).__cancels.length)).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('mock-open-count'))).toBe('1'); expect(computerRequests).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('the login helper exports only whitelisted credentials after explicit save, never chat input or unrelated storage', async ({page})=>{
  const helper=await readFile('android/app/src/main/assets/phone-auth.js','utf8');
  await page.route('https://chat.deepseek.com/**',route=>route.fulfill({contentType:'text/html',body:'<input type="password" value="unrelated-password"><textarea>unrelated-conversation</textarea>'}));
  await page.goto('https://chat.deepseek.com/');
  await page.evaluate(()=>{const w=window as any;w.__authEvents=[];w.MosuanAuthChannel={postMessage:(message:string)=>w.__authEvents.push(JSON.parse(message))};w.fetch=async()=>new Response('{}');localStorage.setItem('userToken',JSON.stringify({value:'synthetic-login-token-not-real'}));localStorage.setItem('private-note','unrelated-storage');});
  await page.addScriptTag({content:helper});
  await page.evaluate(async()=>{await fetch('/api/v0/users/current',{headers:{authorization:'Bearer synthetic-login-token-not-real','x-client-version':'test-version','x-hif-dliq':'test-hif','x-unrelated':'do-not-copy'}});});
  expect(await page.evaluate(()=>(window as any).__authEvents.length)).toBe(0);
  await page.evaluate(()=>(window as any).MosuanAuth.save());
  const data=await page.evaluate(()=>(window as any).__authEvents.at(-1));
  expect(data.kind).toBe('credentials'); expect(data.auth.token).toBe('synthetic-login-token-not-real'); expect(data.auth.headers['x-client-version']).toBe('test-version');
  expect(JSON.stringify(data)).not.toContain('unrelated'); expect(data.auth.headers.authorization).toBeUndefined();
});

test('the login helper refuses foreign origins and reports missing auth without exporting credentials',async({page})=>{
  const helper=await readFile('android/app/src/main/assets/phone-auth.js','utf8');
  await page.route('https://foreign.example/**',route=>route.fulfill({contentType:'text/html',body:'<p>foreign</p>'}));
  await page.goto('https://foreign.example/'); await page.addScriptTag({content:helper}); expect(await page.evaluate(()=>typeof (window as any).MosuanAuth)).toBe('undefined');
  await page.route('https://chat.deepseek.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>login required</p>'}));
  await page.goto('https://chat.deepseek.com/sign_in');
  await page.evaluate(()=>{const w=window as any;w.__authEvents=[];w.MosuanAuthChannel={postMessage:(value:string)=>w.__authEvents.push(JSON.parse(value))};});
  await page.addScriptTag({content:helper}); await page.evaluate(()=>(window as any).MosuanAuth.save());
  expect(await page.evaluate(()=>(window as any).__authEvents)).toEqual([{kind:'missing'}]);
});

test('the actual PoW worker solves its protocol fixture and abort terminates a looping module',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    // Public Apache-2.0 protocol fixtures from FreeDeepseekAPI wasm-host.test.js.
    const ok='AGFzbQEAAAABFQNgAn9/AX9gAX8Bf2AGf39/f39/AAMEAwABAgUDAQABB08EBm1lbW9yeQIAE19fd2JpbmRnZW5fZXhwb3J0XzAAAB9fX3diaW5kZ2VuX2FkZF90b19zdGFja19wb2ludGVyAAEKd2FzbV9zb2x2ZQACCicDBQBBgAgLBABBIAsaACAAQQE2AgAgAEEIakQAAAAAAABFQDkDAAs=';
    const loop='AGFzbQEAAAABFQNgAn9/AX9gAX8Bf2AGf39/f39/AAMEAwABAgUDAQABB08EBm1lbW9yeQIAE19fd2JpbmRnZW5fZXhwb3J0XzAAAB9fX3diaW5kZ2VuX2FkZF90b19zdGFja19wb2ludGVyAAEKd2FzbV9zb2x2ZQACChQDBQBBgAgLBABBIAsHAANADAALCw==';
    const {solvePow}=await import('/src/lib/pow.ts');
    const challenge={algorithm:'DeepSeekHashV1',salt:'salt',expire_at:1710000000,challenge:'abc',difficulty:4};
    const answer=await solvePow(challenge,ok,new AbortController().signal);
    const controller=new AbortController(); const started=performance.now();
    const stopped=solvePow(challenge,loop,controller.signal).then(()=>false,(error:Error)=>error.name==='AbortError');
    setTimeout(()=>controller.abort(),70);
    return {answer,stopped:await stopped,elapsed:performance.now()-started};
  });
  expect(result.answer).toBe(42);expect(result.stopped).toBe(true);expect(result.elapsed).toBeLessThan(2500);
});
