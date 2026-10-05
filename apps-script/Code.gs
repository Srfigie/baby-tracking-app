// Paste into Apps Script. Enable the Google Sheets advanced service.
const LOG_HEADER = ['id','started_at','kind','amount_ml','duration_minutes','detail','notes','created_at','left_seconds','right_seconds'];

function doPost(e) {
  let lock;
  try {
    const request = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const key = props.getProperty('ACCESS_KEY');
    if (!key || !/^[a-f0-9]{64}$/i.test(key) || request.key !== key) return reply_({ok:false,code:'unauthorized',error:'Access key rejected. Check Settings or ask the script owner for the current key.'});
    if (!['read','append','edit'].includes(request.action)) throw Error('Unsupported action.');
    const sheetId = props.getProperty('SPREADSHEET_ID');
    if (!sheetId || !/^[\w-]+$/.test(sheetId)) throw Error('Set SPREADSHEET_ID in Script Properties.');
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    let sheet = spreadsheet.getSheetByName('BabyLog');
    if (!sheet) sheet = spreadsheet.insertSheet('BabyLog');
    let values = Sheets.Spreadsheets.Values.get(sheetId,"'BabyLog'!A:J").values || [];
    if (!values.length) {
      Sheets.Spreadsheets.Values.update({values:[LOG_HEADER]},sheetId,"'BabyLog'!A1:J1",{valueInputOption:'RAW'});
      values = [LOG_HEADER];
    } else {
      if (!LOG_HEADER.slice(0,8).every((v,i)=>values[0][i]===v)) throw Error('The BabyLog columns do not match. Existing data was left unchanged.');
      if (!LOG_HEADER.slice(8).every((v,i)=>values[0][i+8]===v)) {
        if (values.some(row=>row[8]||row[9])) throw Error('Columns I and J are already in use.');
        Sheets.Spreadsheets.Values.update({values:[LOG_HEADER.slice(8)]},sheetId,"'BabyLog'!I1:J1",{valueInputOption:'RAW'});
        values[0] = LOG_HEADER;
      }
    }
    if (request.action === 'read') return reply_({ok:true,sheetId,values});
    validateRow_(request.row);
    const matches = values.map((row,i)=>i>0&&row[0]===request.row[0]?i:-1).filter(i=>i>=0);
    if (request.action === 'append') {
      if (matches.length) {
        if (matches.length!==1 || !sameRow_(values[matches[0]],request.row)) throw Error('Entry ID already exists with different data. Refresh and check the sheet.');
        return reply_({ok:true});
      }
      Sheets.Spreadsheets.Values.append({values:[request.row]},sheetId,"'BabyLog'!A:J",{valueInputOption:'RAW',insertDataOption:'INSERT_ROWS'});
    } else {
      if (!Array.isArray(request.original) || request.original[0]!==request.row[0] || matches.length!==1) throw Error('Entry removed or duplicated. Cancel editing and refresh.');
      const index = matches[0];
      if (!sameRow_(values[index],request.original)) throw Error('This entry changed on another device. Cancel editing and refresh.');
      if (request.row[7]!==values[index][7]) throw Error('Creation time cannot be changed.');
      Sheets.Spreadsheets.Values.update({values:[request.row]},sheetId,"'BabyLog'!A"+(index+1)+':J'+(index+1),{valueInputOption:'RAW'});
    }
    return reply_({ok:true});
  } catch(error) {
    // Do not log request bodies or return Google diagnostics containing credentials.
    const message = String(error.message || 'Request failed.');
    return reply_({ok:false,error:message.startsWith('API call')||message.startsWith('Exception')?'Google Sheets request failed. Check script setup and refresh before retrying.':message});
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
}

function reply_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function sameRow_(a,b) { return Array.from({length:10},(_,i)=>String(a[i]??'')).every((v,i)=>v===String(b[i]??'')); }
function validateRow_(row) {
  if (!Array.isArray(row)||row.length!==10||row.some(v=>typeof v!=='string'&&typeof v!=='number')||typeof row[0]!=='string'||!/^[\w-]{1,100}$/.test(row[0])) throw Error('Invalid entry.');
  if (!['bottle','nursing','pump'].includes(row[2])||![row[1],row[7]].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))||Date.parse(row[1])>Date.now()+60000) throw Error('Invalid entry time or type.');
  if (row[2]==='nursing'?row[3]!=='':typeof row[3]!=='number'||!Number.isFinite(row[3])||row[3]<=0||row[3]>5000) throw Error('Invalid amount.');
  if (row[4]===''?row[2]==='nursing':!Number.isInteger(row[4])||row[4]<1||row[4]>1440) throw Error('Invalid duration.');
  if (!(row[2]==='bottle'?['breast milk','formula','mixed']:['left','right','both']).includes(row[5])||typeof row[6]!=='string'||row[6].length>500) throw Error('Invalid detail or notes.');
  if (row.slice(8).some(v=>v!==''&&(!Number.isInteger(v)||v<0||v>86400))) throw Error('Invalid timer duration.');
}
