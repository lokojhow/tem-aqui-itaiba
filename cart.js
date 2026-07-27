/* Tem Aqui Itaíba — carrinho, pedidos, WhatsApp de cancelados e Minha Feira (V39) */
(function(){
  'use strict';
  const originalProductCard = productCard;
  const originalNavigate = navigate;
  const originalShowAccountPanel = showAccountPanel;
  const CART_KEY = 'cart';

  function ensureCart(){
    if(!Array.isArray(state[CART_KEY])) state[CART_KEY]=[];
    return state[CART_KEY];
  }
  function allProducts(){return [...(state.partnerProducts||[]),...(state.products||[])];}
  function productById(id){return allProducts().find(p=>String(p.id)===String(id));}
  function variantsFor(p){return normalizeProductVariants(p?.variants).filter(v=>v.active!==false);}
  function availableVariants(p){return variantsFor(p).filter(v=>Number(v.stock||0)>0);}
  function variantLabelText(p){const list=variantsFor(p);return list.length?list.map(v=>v.label).join(' • '):'';}
  function storeKey(p){return p.storeId||slugLocal(p.store||'comercio-local');}
  function slugLocal(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'loja';}
  function cartTotalQty(){return ensureCart().reduce((s,i)=>s+Number(i.quantity||0),0);}
  function currentContact(product){
    if(product.contact) return product.contact;
    const store=(state.stores||[]).find(s=>s.name===product.store);
    return store?.whatsapp||'';
  }
  function snapshotProduct(p,variant=null){
    const d=effectiveDelivery(p);
    const selected=variant?variantsFor(p).find(v=>String(v.label)===String(variant)):null;
    const variantKey=selected?.label||'';
    return {key:`${storeKey(p)}::${p.id}::${variantKey||'sem-tamanho'}`,productId:p.id,remote:!!p.remote,storeId:p.storeId||null,storeKey:storeKey(p),storeName:p.store||'Comércio local',storeContact:currentContact(p),name:p.name,variant:variantKey,price:Number(p.price||0),quantity:1,stock:selected?Number(selected.stock||0):(p.stock==null?null:Number(p.stock)),icon:p.icon||'📦',mediaId:p.mediaId||null,deliveryType:d.type,deliveryFee:Number(d.fee||0),deliveryArea:d.area||'',deliveryEstimate:d.estimate||''};
  }
  function updateBadge(){
    const n=cartTotalQty();
    ['headerCartCount','floatingCartCount'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent=n;el.classList.toggle('empty',!n)}});
    const nav=document.getElementById('navCartCount');if(nav)nav.textContent=n?`(${n})`:'';
  }
  function saveCart(){saveState();updateBadge();if(currentView==='cart')renderCart();}

  function ensureVariantPicker(){
    if(document.getElementById('productVariantPickerModal'))return;
    const modal=document.createElement('div');modal.id='productVariantPickerModal';modal.className='modal-backdrop';modal.innerHTML='<div class="modal" style="width:min(540px,100%)"><div class="modal-head"><h3 id="variantPickerTitle">Escolha uma opção</h3><button class="close" onclick="closeModal(\'productVariantPickerModal\')">✕</button></div><div style="padding:18px"><p id="variantPickerText" class="section-sub"></p><div id="variantPickerGrid" class="size-picker-grid"></div></div></div>';document.body.appendChild(modal);
  }
  window.openProductVariantPicker=function(id){const p=productById(id);if(!p)return toast('Produto não encontrado.');const list=variantsFor(p);if(!list.length)return addToCart(id,'');ensureVariantPicker();document.getElementById('variantPickerTitle').textContent='Escolha uma opção';document.getElementById('variantPickerText').textContent=p.name+' — selecione o tamanho, a numeração ou a medida para adicionar ao carrinho.';document.getElementById('variantPickerGrid').innerHTML=list.map(v=>`<button class="size-picker-btn" ${Number(v.stock||0)<=0?'disabled':''} onclick="addToCart('${escAttr(p.id)}','${escAttr(v.label)}')">${esc(v.label)}<br><small>${Number(v.stock||0)>0?Number(v.stock)+' em estoque':'Esgotado'}</small></button>`).join('');openModal('productVariantPickerModal')};
  window.addToCart=function(id,variant=''){
    const p=productById(id);if(!p)return toast('Produto não encontrado.');
    const variants=variantsFor(p);
    if(variants.length&&!variant)return openProductVariantPicker(id);
    const selected=variant?variants.find(v=>String(v.label)===String(variant)):null;
    if(variants.length&&!selected)return toast('Escolha uma opção válida.');
    const availableStock=selected?Number(selected.stock||0):Number(p.stock);
    if(availableStock===0)return toast(selected?`A opção ${selected.label} está esgotada.`:'Este produto está esgotado.');
    const cart=ensureCart();const key=`${storeKey(p)}::${p.id}::${selected?.label||'sem-tamanho'}`;let item=cart.find(i=>i.key===key);
    if(item){const max=item.stock&&item.stock>0?item.stock:999;if(item.quantity>=max)return toast('Você atingiu a quantidade disponível.');item.quantity++;}
    else cart.push(snapshotProduct(p,selected?.label||''));
    saveCart();closeModal('productVariantPickerModal');toast(`${p.name}${selected?' — '+selected.label:''} foi adicionado ao carrinho.`);
  };
  window.changeCartQty=function(key,delta){const item=ensureCart().find(i=>i.key===key);if(!item)return;const next=item.quantity+delta;if(next<=0)return removeCartItem(key);if(item.stock&&next>item.stock)return toast('Quantidade maior que o estoque informado.');item.quantity=next;saveCart();};
  window.removeCartItem=function(key){state.cart=ensureCart().filter(i=>i.key!==key);saveCart();toast('Item removido.');};
  window.clearStoreCart=function(key){if(!confirm('Remover todos os produtos deste comércio?'))return;state.cart=ensureCart().filter(i=>i.storeKey!==key);saveCart();};
  window.clearWholeCart=function(){if(!confirm('Esvaziar todo o carrinho?'))return;state.cart=[];saveCart();};

  productCard=function(p){
    const fav=state.favorites.includes(p.id);const delivery=deliveryLabel(p);
    return `<article class="card product-card">${p.sponsored?'<span class="sponsored">Patrocinado</span>':''}<button class="favorite ${fav?'active':''}" onclick="toggleFavorite('${p.id}')">${fav?'♥':'♡'}</button><div class="product-media" id="pm-${p.id}"><span>${p.icon||'📦'}</span></div><div class="product-body"><div class="product-name">${esc(p.name)}</div><div class="old-price">De ${money(p.oldPrice||p.price)}</div><div class="price">${money(p.price)}</div><div class="store">${esc(p.store)} • ${p.createdAt?'publicado recentemente':'produto cadastrado'}</div><div class="delivery-badge ${delivery.cls}">${delivery.icon} ${delivery.text}</div>${variantLabelText(p)?`<div class="product-size-line">Opções: ${esc(variantLabelText(p))}</div>`:''}${effectiveDelivery(p).area?`<div class="store">${esc(effectiveDelivery(p).area)}</div>`:''}<div class="actions cart-actions"><button class="btn add-cart" onclick="addToCart('${p.id}')">🛒 ${variantsFor(p).length?'Escolher opção':'Adicionar ao carrinho'}</button><button class="btn btn-soft" onclick="openChat('${escAttr(p.store)}','${escAttr(p.name)}','🛍️')">Conversar</button><button class="btn btn-wa square" onclick="openChat('${escAttr(p.store)}','${escAttr(p.name)}','🛍️')">💬</button></div></div></article>`;
  };

  function groups(){
    const m=new Map();for(const item of ensureCart()){if(!m.has(item.storeKey))m.set(item.storeKey,{key:item.storeKey,name:item.storeName,storeId:item.storeId,contact:item.storeContact,items:[]});m.get(item.storeKey).items.push(item);}return [...m.values()];
  }
  function groupAmounts(g){const subtotal=g.items.reduce((s,i)=>s+i.price*i.quantity,0);const types=g.items.map(i=>i.deliveryType);let type=types.includes('paid')?'paid':types.every(t=>t==='free')?'free':types.every(t=>t==='pickup')?'pickup':'arrange';let fee=type==='paid'?Math.max(...g.items.map(i=>Number(i.deliveryFee||0))):0;return{subtotal,type,fee,total:subtotal+fee};}
  function mediaFor(item){if(typeof item.mediaId==='string'&&/^https?:/.test(item.mediaId))return `<img src="${esc(item.mediaId)}" alt="${esc(item.name)}">`;return `<span>${item.icon||'📦'}</span>`;}
  function globalForm(){
    return `<div class="cart-summary"><h2>Finalizar compra</h2><p class="section-sub">Cada comércio receberá um pedido separado.</p><div class="cart-fields"><label>Endereço de entrega<input id="cartAddress" placeholder="Rua, número, bairro"></label><label>Forma de pagamento<select id="cartPayment"><option value="pix">Pix direto para a loja</option><option value="cash">Dinheiro na entrega</option><option value="card_on_delivery">Cartão na entrega</option><option value="store">Pagar na retirada</option></select></label><label>Observação geral<textarea id="cartNotes" rows="3" placeholder="Ex.: trocar por outra marca se faltar"></textarea></label></div><div class="summary-row"><span>Produtos</span><b>${cartTotalQty()}</b></div><div class="summary-row total"><span>Total estimado</span><b>${money(groups().reduce((s,g)=>s+groupAmounts(g).total,0))}</b></div><div class="form-note">O preço e o estoque serão confirmados pelo comércio. Produtos por peso podem sofrer pequena alteração no valor final.</div><div class="cart-checkout-actions" style="margin-top:12px"><button class="btn btn-danger" onclick="clearWholeCart()">Esvaziar carrinho</button></div></div>`;
  }
  window.renderCart=function(){
    updateBadge();const root=document.getElementById('cartContent');if(!root)return;const gs=groups();
    if(!gs.length){root.innerHTML='<div class="cart-empty"><div style="font-size:60px">🛒</div><b>Seu carrinho está vazio</b>Pesquise produtos e adicione tudo o que precisa para sua feira.<br><br><button class="btn btn-primary" onclick="navigate(\'home\')">Procurar produtos</button></div>';return;}
    const storesHtml=gs.map(g=>{const a=groupAmounts(g);return `<article class="cart-store"><div class="cart-store-head"><div><h3>🏪 ${esc(g.name)}</h3><small>${g.items.length} produto(s) • pedido separado</small></div><button class="btn btn-danger" onclick="clearStoreCart('${escAttr(g.key)}')">Limpar loja</button></div>${g.items.map(i=>`<div class="cart-item"><div class="cart-item-media">${mediaFor(i)}</div><div><h4>${esc(i.name)}</h4>${i.variant?`<span class="cart-item-variant">Opção: ${esc(i.variant)}</span>`:''}<p>${money(i.price)} cada</p><div class="qty"><button onclick="changeCartQty('${escAttr(i.key)}',-1)">−</button><b>${i.quantity}</b><button onclick="changeCartQty('${escAttr(i.key)}',1)">+</button></div></div><div class="cart-line"><strong>${money(i.price*i.quantity)}</strong><button onclick="removeCartItem('${escAttr(i.key)}')">Remover</button></div></div>`).join('')}<div class="cart-store-total"><div class="summary-row"><span>Subtotal</span><b>${money(a.subtotal)}</b></div><div class="summary-row"><span>${a.type==='free'?'Entrega grátis':a.type==='paid'?'Frete estimado':a.type==='pickup'?'Retirada':'Entrega a combinar'}</span><b>${a.fee?money(a.fee):'—'}</b></div><div class="summary-row total"><span>Total estimado</span><b>${money(a.total)}</b></div><div class="cart-checkout-actions"><button class="btn btn-wa" onclick="checkoutStoreWhatsApp('${escAttr(g.key)}')">Enviar pedido pelo WhatsApp</button><button class="btn btn-blue" onclick="placeStoreOrder('${escAttr(g.key)}')">Fazer pedido no aplicativo</button></div></div></article>`}).join('');
    root.innerHTML=`<div class="cart-layout"><div>${storesHtml}</div>${globalForm()}</div>`;
  };
  function checkoutData(g){const a=groupAmounts(g);return{...a,address:document.getElementById('cartAddress')?.value.trim()||'',payment:document.getElementById('cartPayment')?.value||'pix',notes:document.getElementById('cartNotes')?.value.trim()||''};}
  function paymentLabel(v){return({pix:'Pix direto para a loja',cash:'Dinheiro na entrega',card_on_delivery:'Cartão na entrega',store:'Pagar na retirada'})[v]||v;}
  window.checkoutStoreWhatsApp=function(key){const g=groups().find(x=>x.key===key);if(!g)return;const d=checkoutData(g);let msg=`Olá! Quero fazer este pedido pelo Tem Aqui Itaíba:\n\n`;g.items.forEach(i=>msg+=`${i.quantity}x ${i.name}${i.variant?' ('+i.variant+')':''} — ${money(i.price*i.quantity)}\n`);msg+=`\nSubtotal: ${money(d.subtotal)}\n`;if(d.fee)msg+=`Frete estimado: ${money(d.fee)}\n`;msg+=`Total estimado: ${money(d.total)}\nForma de pagamento: ${paymentLabel(d.payment)}\n`;if(d.address)msg+=`Endereço: ${d.address}\n`;if(d.notes)msg+=`Observação: ${d.notes}\n`;msg+='\nPor favor, confirme estoque, valor e prazo de entrega.';if(!g.contact)return toast('Este comércio ainda não informou um WhatsApp. Use o chat do aplicativo.');contactWhatsApp(g.contact,msg);};
  window.placeStoreOrder=async function(key){
    const g=groups().find(x=>x.key===key);if(!g)return;const api=window.temAquiOnline;const client=api?.client;const session=api?.session;if(!session){openModal('authModal');toast('Entre na sua conta para fazer o pedido.');return;}if(!g.storeId){toast('Este produto é demonstrativo. Para testar pedido online, use produtos cadastrados por parceiros reais.');return;}const d=checkoutData(g);if(d.type!=='pickup'&&!d.address){toast('Informe o endereço de entrega.');return;}
    try{
      const {data:order,error}=await client.from('orders').insert({buyer_id:session.user.id,store_id:g.storeId,status:'pending',delivery_type:d.type==='paid'?'fixed_fee':d.type,delivery_fee:d.fee,payment_method:d.payment,delivery_address:d.address||null,notes:d.notes||null}).select('id').single();if(error)throw error;
      const rows=g.items.map(i=>({order_id:order.id,product_id:i.remote?i.productId:null,product_name:i.name+(i.variant?' — '+i.variant:''),unit_price:i.price,quantity:i.quantity}));
      const {error:itemError}=await client.from('order_items').insert(rows);if(itemError)throw itemError;
      state.cart=ensureCart().filter(i=>i.storeKey!==key);saveCart();toast('Pedido enviado! O comércio recebeu no painel.');
    }catch(e){console.error(e);toast(e.message?.includes('does not exist')?'Execute primeiro o arquivo SQL da Etapa 8 no Supabase.':(e.message||'Não foi possível enviar o pedido.'));}
  };

  navigate=function(view){originalNavigate(view);if(view==='cart')renderCart();};

  async function fetchOrders(mode){
    const api=window.temAquiOnline;const client=api?.client,session=api?.session;if(!session)return[];
    if(mode==='buyer'){const {data,error}=await client.from('orders').select('*,stores(name,whatsapp),order_items(*)').eq('buyer_id',session.user.id).order('created_at',{ascending:false});if(error)throw error;return data||[];}
    const {data:stores,error:sError}=await client.from('stores').select('id,name').eq('owner_id',session.user.id);if(sError)throw sError;const ids=(stores||[]).map(s=>s.id);if(!ids.length)return[];const {data,error}=await client.from('orders').select('*,profiles!orders_buyer_id_fkey(nome),stores(name),order_items(*)').in('store_id',ids).order('created_at',{ascending:false});if(error)throw error;return data||[];
  }
  function orderStatusLabel(s){return({pending:'Novo pedido',confirmed:'Confirmado',preparing:'Separando',out_for_delivery:'Saiu para entrega',delivered:'Entregue',cancelled:'Cancelado'})[s]||s;}
  function ordersHtml(list,received){return list.map(o=>`<article class="order-card"><div class="order-card-head"><div><h4>Pedido #${String(o.id).slice(0,8).toUpperCase()}</h4><small>${new Date(o.created_at).toLocaleString('pt-BR')} • ${received?esc(o.profiles?.nome||'Cliente'):esc(o.stores?.name||'Comércio')}</small></div><span class="order-status ${o.status}">${orderStatusLabel(o.status)}</span></div><div class="order-items-mini">${(o.order_items||[]).map(i=>`${i.quantity}x ${esc(i.product_name)} — ${money(i.unit_price*i.quantity)}`).join('<br>')||'Itens aguardando carregamento.'}</div><div class="summary-row total"><span>Total</span><b>${money(o.total)}</b></div>${received&&o.status!=='delivered'&&o.status!=='cancelled'?`<div class="actions"><button class="btn btn-soft" onclick="updateOrderStatus('${o.id}','confirmed')">Confirmar</button><button class="btn btn-soft" onclick="updateOrderStatus('${o.id}','preparing')">Separando</button><button class="btn btn-blue" onclick="updateOrderStatus('${o.id}','out_for_delivery')">Saiu</button><button class="btn btn-primary" onclick="updateOrderStatus('${o.id}','delivered')">Entregue</button></div>`:''}${received&&o.status==='cancelled'?`<button class="btn btn-wa" onclick="contactCancelledOrder('${o.id}','${escAttr(o.profiles?.nome||'cliente')}')">💬 Chamar no WhatsApp</button>`:''}${!received&&o.status==='pending'?`<button class="btn btn-danger" onclick="updateOrderStatus('${o.id}','cancelled',true)">Cancelar pedido</button>`:''}</article>`).join('')||'<div class="empty">Nenhum pedido encontrado.</div>';}
  async function renderOrdersPanel(mode){const c=document.getElementById('accountContent');c.innerHTML='<h2>Carregando pedidos...</h2>';try{const list=await fetchOrders(mode);c.innerHTML=`<div class="section-head"><div><h2>${mode==='buyer'?'Meus pedidos':'Pedidos recebidos'}</h2><div class="section-sub">${list.length} pedido(s) no banco online.</div></div></div>${ordersHtml(list,mode==='received')}`;}catch(e){c.innerHTML=`<div class="empty"><b>Não foi possível carregar os pedidos.</b><br>${esc(e.message||'')}</div>`;}}
  window.contactCancelledOrder=async function(orderId,buyerName='cliente'){const api=window.temAquiOnline;const client=api?.client;if(!client)return toast('Banco online indisponível.');try{const {data,error}=await client.rpc('get_order_buyer_contact',{order_uuid:orderId});if(error)throw error;const row=Array.isArray(data)?data[0]:data;const whatsapp=row?.buyer_whatsapp||'';if(!whatsapp)return toast('Este cliente não informou WhatsApp no cadastro.');const code=String(orderId).slice(0,8).toUpperCase();const name=row?.buyer_name||buyerName||'cliente';const message=`Olá, ${name}! Vimos que o pedido #${code} foi cancelado no Tem Aqui Itaíba. Podemos ajudar ou esclarecer alguma dúvida?`;contactWhatsApp(whatsapp,message)}catch(e){toast(/get_order_buyer_contact|function .* does not exist/i.test(e?.message||'')?'Execute primeiro a Etapa 27 no Supabase.':(e.message||'Não foi possível abrir o WhatsApp.'))}};
  showAccountPanel=function(panel,btn){if(panel==='buyerOrders'){document.querySelectorAll('.account-menu button').forEach(b=>b.classList.remove('active'));btn?.classList.add('active');renderOrdersPanel('buyer');return;}if(panel==='receivedOrders'){document.querySelectorAll('.account-menu button').forEach(b=>b.classList.remove('active'));btn?.classList.add('active');renderOrdersPanel('received');return;}return originalShowAccountPanel(panel,btn);};
  window.updateOrderStatus=async function(id,status,buyer=false){const api=window.temAquiOnline;const client=api?.client;if(!client)return toast('Banco online indisponível.');try{const {error}=await client.from('orders').update({status}).eq('id',id);if(error)throw error;toast('Status atualizado.');renderOrdersPanel(buyer?'buyer':'received');}catch(e){toast(e.message||'Não foi possível atualizar o pedido.');}};

  window.addEventListener('load',()=>{ensureVariantPicker();ensureCart();updateBadge();setTimeout(()=>{renderHome();updateBadge();},250);});
})();
