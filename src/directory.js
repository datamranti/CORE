// ── CORE CONTACT DIRECTORY & BUSINESS-CARD INTAKE ──
let contactDirectoryMode = 'directory';
let contactIntakeRows = [];
let contactIntakeBusy = false;

function contactDirectoryEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
}

function contactDirectoryNormal(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9@+]+/g,' ').replace(/\s+/g,' ').trim();
}

function contactDirectoryPhone(value) {
  return String(value || '').replace(/\D+/g,'');
}

function contactDirectoryGroupSource(group) {
  const meeting = Array.isArray(group?.meetingRecords) ? group.meetingRecords.length > 0 : (group?.records || []).some(entry => !crmIsContactOnlyRecord(entry.record));
  const card = Array.isArray(group?.contactOnlyRecords) ? group.contactOnlyRecords.length > 0 : (group?.allRecords || []).some(entry => crmIsContactOnlyRecord(entry.record));
  if (meeting && card) return 'both';
  if (card) return 'business-card';
  return 'meeting';
}

function contactDirectoryActivate() {
  try { if (!crmContactsLoaded && !crmContactsLoading) crmLoadContacts(false); } catch (error) {}
  contactDirectorySetMode(contactDirectoryMode, { silent:true });
  contactDirectoryRender();
}

function contactDirectorySetMode(mode, options = {}) {
  contactDirectoryMode = mode === 'intake' ? 'intake' : 'directory';
  const directory = document.getElementById('contactDirectoryView');
  const intake = document.getElementById('contactIntakeView');
  const directoryTab = document.getElementById('contactDirectoryTab');
  const intakeTab = document.getElementById('contactIntakeTab');
  if (directory) directory.hidden = contactDirectoryMode !== 'directory';
  if (intake) intake.hidden = contactDirectoryMode !== 'intake';
  directoryTab?.classList.toggle('active', contactDirectoryMode === 'directory');
  intakeTab?.classList.toggle('active', contactDirectoryMode === 'intake');
  if (contactDirectoryMode === 'directory') contactDirectoryRender();
  else contactIntakeRender();
}

function contactDirectoryRender() {
  const grid = document.getElementById('contactDirectoryGrid');
  const summary = document.getElementById('contactDirectorySummary');
  if (!grid || !summary) return;
  try { crmBuildContactGroups(true); } catch (error) {}
  const groups = Array.isArray(crmContactGroups) ? crmContactGroups : [];
  const query = contactDirectoryNormal(document.getElementById('contactDirectorySearch')?.value || '');
  const sourceFilter = document.getElementById('contactDirectorySource')?.value || 'all';
  const visible = groups.filter(group => {
    const source = contactDirectoryGroupSource(group);
    if (sourceFilter !== 'all' && source !== sourceFilter) return false;
    if (!query) return true;
    const haystack = contactDirectoryNormal([group.name,group.company,group.email,group.phone,group.jobTitle,group.department].filter(Boolean).join(' '));
    return haystack.includes(query);
  }).sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));
  const businessCardCount = groups.filter(group => ['business-card','both'].includes(contactDirectoryGroupSource(group))).length;
  summary.innerHTML = `<strong>${visible.length}</strong> shown · <strong>${groups.length}</strong> total contacts · <strong>${businessCardCount}</strong> with business-card records`;
  if (!visible.length) {
    grid.innerHTML = '<div class="contacts-directory-empty">No contacts match this search or filter.</div>';
    return;
  }
  grid.innerHTML = visible.map(group => {
    const source = contactDirectoryGroupSource(group);
    const record = group.latest || group.allRecords?.[0]?.record || {};
    const recordKey = typeof crmRecordRouteKey === 'function' ? crmRecordRouteKey(record) : '';
    const initials = typeof crmIntelInitials === 'function' ? crmIntelInitials(group.name) : String(group.name||'?').slice(0,2).toUpperCase();
    const sourceLabel = source === 'both' ? 'Meeting + Card' : source === 'business-card' ? 'Business Card' : 'Meeting';
    return `<button class="contacts-directory-card" type="button" onclick="contactDirectoryOpenContext('${contactDirectoryEscape(recordKey)}')">
      <span class="contacts-directory-avatar">${contactDirectoryEscape(initials)}</span>
      <span class="contacts-directory-copy"><strong>${contactDirectoryEscape(group.name)}</strong><span>${contactDirectoryEscape(group.company)}</span><small>${contactDirectoryEscape([group.jobTitle,group.email,group.phone].filter(Boolean).join(' · ') || 'Contact details not recorded')}</small></span>
      <span class="contacts-directory-source source-${source}">${sourceLabel}</span>
      <span class="contacts-directory-arrow" aria-hidden="true">→</span>
    </button>`;
  }).join('');
}

function contactDirectoryOpenContext(recordKey) {
  systemNavigate('contacts', recordKey ? { recordKey } : {});
}

function contactIntakeExistingGroups() {
  try { crmBuildContactGroups(true); } catch (error) {}
  return Array.isArray(crmContactGroups) ? crmContactGroups : [];
}

function contactIntakeDuplicate(contact, rowIndex = -1) {
  const email = contactDirectoryNormal(contact.email);
  const phone = contactDirectoryPhone(contact.contactNumber);
  const name = contactDirectoryNormal(contact.personName);
  const company = contactDirectoryNormal(contact.companyName);
  const existing = contactIntakeExistingGroups().find(group => {
    const ge = contactDirectoryNormal(group.email);
    const gp = contactDirectoryPhone(group.phone);
    const gn = contactDirectoryNormal(group.name);
    const gc = contactDirectoryNormal(group.company);
    return (email && ge === email) || (phone.length >= 7 && gp === phone) || (name && company && gn === name && gc === company);
  });
  if (existing) return `Already in CORE: ${existing.name}${existing.company ? ' · ' + existing.company : ''}`;
  const batch = contactIntakeRows.find((row,index) => {
    if (index === rowIndex) return false;
    const re = contactDirectoryNormal(row.email);
    const rp = contactDirectoryPhone(row.contactNumber);
    const rn = contactDirectoryNormal(row.personName);
    const rc = contactDirectoryNormal(row.companyName);
    return (email && re === email) || (phone.length >= 7 && rp === phone) || (name && company && rn === name && rc === company);
  });
  return batch ? 'Duplicate in this upload batch' : '';
}

function contactIntakeStatus(contact, index) {
  const missing=[];
  if (!String(contact.personName||'').trim()) missing.push('name');
  if (!String(contact.companyName||'').trim()) missing.push('organisation');
  if (!String(contact.email||'').trim() && !String(contact.contactNumber||'').trim()) missing.push('email or phone');
  if (String(contact.email||'').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contact.email).trim())) missing.push('valid email');
  const duplicate=contactIntakeDuplicate(contact,index);
  if (duplicate) return {type:'duplicate',label:'Duplicate',detail:duplicate};
  if (missing.length) return {type:'review',label:'Review',detail:'Missing ' + missing.join(', ')};
  return {type:'ready',label:'Ready',detail:'Ready to save'};
}

async function contactIntakeHandleFiles(fileList) {
  const files=Array.from(fileList||[]);
  if (!files.length) return;
  if (files.length > 30) { contactIntakeSetState('Select a maximum of 30 files per batch.','error'); return; }
  contactIntakeBusy=true;
  contactIntakeRows=[];
  contactIntakeRender();
  let processed=0;
  for (const file of files) {
    const supported=String(file.type||'').startsWith('image/') || file.type==='application/pdf' || /\.pdf$/i.test(file.name||'');
    if (!supported) { contactIntakeRows.push({personName:'',companyName:'',email:'',contactNumber:'',jobTitle:'',sourceFile:file.name,_analysisError:'Unsupported file type'}); continue; }
    if (file.size > 20*1024*1024) { contactIntakeRows.push({personName:'',companyName:'',email:'',contactNumber:'',jobTitle:'',sourceFile:file.name,_analysisError:'File exceeds 20 MB'}); continue; }
    contactIntakeSetState(`Analysing ${processed+1} of ${files.length}: ${file.name}`,'loading');
    try {
      const fd=new FormData();
      fd.append('businessCard',file);
      fd.append('fileName',file.name||'business-card');
      const response=await fetch(BUSINESS_CARD_ANALYSIS_URL,{method:'POST',body:fd});
      const text=await response.text();
      let data={}; try{data=text?JSON.parse(text):{};}catch(e){}
      if(!response.ok || data.success===false) throw new Error(data.error||data.message||`Analysis failed (${response.status})`);
      const contacts=Array.isArray(data.contacts)?data.contacts:[];
      contacts.forEach((entry,localIndex)=>{
        const normalized=typeof normalizeReviewedContact==='function'?normalizeReviewedContact(entry,contactIntakeRows.length):{personName:entry.personName||entry.name||'',companyName:entry.companyName||entry.company||'',email:entry.email||'',contactNumber:entry.contactNumber||entry.phone||'',jobTitle:entry.jobTitle||entry.designation||''};
        contactIntakeRows.push({...normalized,sourceFile:file.name,cardNumber:localIndex+1});
      });
      if(!contacts.length) contactIntakeRows.push({personName:'',companyName:'',email:'',contactNumber:'',jobTitle:'',sourceFile:file.name,_analysisError:'No card detected'});
    } catch(error) {
      contactIntakeRows.push({personName:'',companyName:'',email:'',contactNumber:'',jobTitle:'',sourceFile:file.name,_analysisError:error.message||'Analysis failed'});
    }
    processed++;
    contactIntakeRender();
  }
  contactIntakeBusy=false;
  contactIntakeSetState(`${contactIntakeRows.length} contact${contactIntakeRows.length===1?'':'s'} detected from ${files.length} file${files.length===1?'':'s'}. Review before saving.`,'done');
  contactIntakeRender();
  const input=document.getElementById('contactIntakeFiles'); if(input) input.value='';
}

function contactIntakeSetState(message,mode='') {
  const el=document.getElementById('contactIntakeState');
  if(!el)return;
  el.textContent=message||'';
  el.className='contacts-intake-state'+(mode?' '+mode:'');
}

function contactIntakeUpdate(index,field,value) {
  if(!contactIntakeRows[index])return;
  contactIntakeRows[index][field]=String(value||'');
  contactIntakeRender();
}

function contactIntakeRemove(index) {
  contactIntakeRows.splice(index,1);
  contactIntakeRender();
}

function contactIntakeRender() {
  const body=document.getElementById('contactIntakeTableBody');
  const count=document.getElementById('contactIntakeCount');
  const save=document.getElementById('contactIntakeSaveButton');
  const note=document.getElementById('contactIntakeSaveNote');
  if(!body||!count||!save)return;
  count.textContent=`${contactIntakeRows.length} contact${contactIntakeRows.length===1?'':'s'}`;
  if(!contactIntakeRows.length){body.innerHTML='<tr><td colspan="7"><div class="contacts-directory-empty">Upload business cards to begin.</div></td></tr>';save.disabled=true;if(note)note.textContent='Duplicates are not saved as new contacts.';return;}
  let ready=0,duplicates=0,review=0;
  body.innerHTML=contactIntakeRows.map((contact,index)=>{
    let status=contact._analysisError?{type:'review',label:'Review',detail:contact._analysisError}:contactIntakeStatus(contact,index);
    if(status.type==='ready')ready++; else if(status.type==='duplicate')duplicates++; else review++;
    return `<tr>
      <td><span class="contacts-intake-badge ${status.type}" title="${contactDirectoryEscape(status.detail)}">${status.label}</span><small class="contacts-intake-file">${contactDirectoryEscape(contact.sourceFile||'')}</small></td>
      <td><input value="${contactDirectoryEscape(contact.personName||'')}" oninput="contactIntakeUpdate(${index},'personName',this.value)" placeholder="Name"/></td>
      <td><input value="${contactDirectoryEscape(contact.companyName||'')}" oninput="contactIntakeUpdate(${index},'companyName',this.value)" placeholder="Organisation"/></td>
      <td><input type="email" value="${contactDirectoryEscape(contact.email||'')}" oninput="contactIntakeUpdate(${index},'email',this.value)" placeholder="Email"/></td>
      <td><input value="${contactDirectoryEscape(contact.contactNumber||'')}" oninput="contactIntakeUpdate(${index},'contactNumber',this.value)" placeholder="Phone"/></td>
      <td><input value="${contactDirectoryEscape(contact.jobTitle||'')}" oninput="contactIntakeUpdate(${index},'jobTitle',this.value)" placeholder="Role"/></td>
      <td><button class="contacts-intake-remove" onclick="contactIntakeRemove(${index})" type="button" aria-label="Remove contact">×</button></td>
    </tr>`;
  }).join('');
  save.disabled=contactIntakeBusy||ready===0||review>0;
  save.textContent=contactIntakeBusy?'Working…':`Save ${ready} contact${ready===1?'':'s'} to CORE`;
  if(note)note.textContent=`${ready} ready · ${duplicates} duplicate${duplicates===1?'':'s'} · ${review} require review. Duplicates will be skipped.`;
}

async function contactIntakeSave() {
  if(contactIntakeBusy)return;
  const ready=contactIntakeRows.filter((contact,index)=>contactIntakeStatus(contact,index).type==='ready').map(contact=>({personName:String(contact.personName||'').trim(),companyName:String(contact.companyName||'').trim(),email:String(contact.email||'').trim(),contactNumber:String(contact.contactNumber||'').trim(),jobTitle:String(contact.jobTitle||'').trim(),sourceFile:String(contact.sourceFile||'').trim()}));
  if(!ready.length){contactIntakeSetState('No new contacts are ready to save.','error');return;}
  contactIntakeBusy=true;contactIntakeRender();contactIntakeSetState(`Saving ${ready.length} contact${ready.length===1?'':'s'}…`,'loading');
  try{
    const result=await crmPost(CONTACT_INTAKE_URL,{contacts:ready,uploaderName:currentUser?.displayName||'',uploaderEmail:currentUser?.email||''});
    const saved=Number(result.savedContacts||ready.length);
    contactIntakeRows=[];
    contactIntakeSetState(`${saved} contact${saved===1?' was':'s were'} saved to CORE.`,'done');
    crmContactsLoaded=false;crmContactGroupsDirty=true;
    await crmLoadContacts(true);
    contactDirectoryRender();
    contactIntakeRender();
  }catch(error){contactIntakeSetState(error.message||'Unable to save contacts.','error');}
  finally{contactIntakeBusy=false;contactIntakeRender();}
}

(function contactIntakeDropSupport(){
  const setup=()=>{const zone=document.getElementById('contactIntakeDropzone');if(!zone||zone.dataset.bound)return;zone.dataset.bound='true';['dragenter','dragover'].forEach(name=>zone.addEventListener(name,event=>{event.preventDefault();zone.classList.add('dragging');}));['dragleave','drop'].forEach(name=>zone.addEventListener(name,event=>{event.preventDefault();zone.classList.remove('dragging');}));zone.addEventListener('drop',event=>contactIntakeHandleFiles(event.dataTransfer?.files));};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
