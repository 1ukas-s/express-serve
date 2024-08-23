const fs = require('fs').promises;
const path = require('path');
const { hasLaunchFlag, getLaunchOption } = require('scripts/launchoptions.js');
const fileType = require('file-type');

const express = require('express');

const { client } = require('pg');
const mypg = require('scripts/postgres.js');

const launchHTTPS = hasLaunchFlag('-s', '--https');
const launchHTTP = !hasLaunchFlag('-n', '--no-http');

const port = (getLaunchOption(80, '-p', '--port') - 1)%65535 + 1;
const HTTPSport = (getLaunchOption(443 - 1*launchHTTP, '-p', '--port') - 1*!launchHTTP)%65535 + 1;

const virtualPath = getLaunchOption('/public', '-d', '--path');

mypg.setdb({user: 'readonly_user', password: 'abcdef', database: 'kdb'});
process.env.TZ = 'America/New_York'
const logOptions = Object.freeze({ hour12: false, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', });
const logLocale = getLaunchOption('en-gb', '--locale');
// Intl.DateTimeFormat().resolvedOptions().timeZone

const app = express();
var hasIcons = false; 
(async function () {
	if ((await fs.readdir(path.join(__dirname, 'public'))).includes('icons')){ hasIcons = (await fs.stat(path.join(__dirname, 'public'))).isDirectory(); }
})();
var newline = false;
var lastConnectData = { ip: null }
var loggingTimeout = setTimeout(() => {newline = true}, 1);

const iconMap = {html: 'generic', png: 'image2', ico: 'image2'}
const templateStrings = [
	'<!DOCTYPE html><html><head><style type="text/css">* :link {color: #ff0;} * :visited {color: #f0f;} td:not(:first-of-type) {padding-right: 25px;}</style><meta http-equiv="content-type" content="text/html; charset=UTF-8"><title>',
	'</title></head><body style="color: rgb(210, 210, 210); background-color: rgb(20, 20, 20);"><h1>',
	//'</h1><hr><pre>',
	//'</pre></body></html>'
	'</h1><table style="font-family: -moz-fixed; font-size: 12pt; line-height: 26px; min-width: 35%; max-width: 100%; width: fit-content;"><tbody><tr><th valign="top"><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="dir/?C=N;O=D">Name</a></th><th><a href="dir/?C=M;O=A">Last modified</a></th><th><a href="dir/?C=S;O=A">Size</a></th><th><a href="dir/?C=D;O=A">Description</a></th></tr><tr><th colspan="5"><hr></th></tr>',
	'<tr><th colspan="5"><hr></th></tr></tbody></table></body></html>'
]

// Add the virtual path to the requested path before any response.
app.use((req, res, next) => {
	req.vpath = virtualPath + req.path;
	next();
});

// Log any connection attempts before response.
app.use(log);

// Fail any GET requests on urls that look like .../sql/...
app.get('*/sql/*', (req, res) => { res.status(404).send('404 Not Found'); });

// Attempt to access SQL server with provided query parameters.
app.get('*/sql', GETsql);

// Send some information about the request/response back as a big HTML file (for debugging, may not be safe)
//app.get('*/req*', (req, res) => { return res.send(getDebugHTML(req, 'Request').totalHTML); });
//app.get('*/res*', (req, res) => { return res.send(getDebugHTML(res, 'Response').totalHTML); });
//app.get('*/app*', (req, res) => { return res.send(getDebugHTML(app, 'app').totalHTML); });

// Respond "normally" to a basic GET request from the /public directory.
app.get('*', GETfile);

//app.post('*', handlePOST);

const http = require('http');
const https = require('https');

// Host IP address. Not important to change unless the node docker image is set to 'bridge' mode.
const HOST = '0.0.0.0';

if (launchHTTPS) {
	(async () => {
		const folder = path.join('/usr/certs/', (await fs.readFile('/usr/certs/DEFAULT', 'utf-8')).trim());
		const keyp = path.join(folder, 'privkey.pem'); const certp = path.join(folder, 'fullchain.pem');
		
		const [key, cert] = await Promise.all([ fs.readFile(keyp), fs.readFile(certp), ]);
		return { key: key, cert: cert, };
	})
	() .then(async (value) => { 
		await https.createServer(value, app).listen(443, HOST, (err) => { 
			if (err) {console.error(err)};
			const timestamp = formatDateString(new Date, Object.assign({...logOptions}, { year: undefined, }));
			console.log(`${timestamp}| HTTPS server started on ${HOST == '0.0.0.0' || HOST == '127.0.0.1' ? 'localhost' : HOST}:${HTTPSport}`);
		});
	}) .catch((error) => { console.error('Error creating HTTPS options:', error); });
}

if (launchHTTP) {
	http.createServer(app).listen(80, HOST, (err) => { 
		if (err) {console.error(err)};
		const timestamp = formatDateString(new Date, Object.assign({...logOptions}, { year: undefined, }));
		console.log(`${timestamp}| HTTP server started on ${HOST == '0.0.0.0' || HOST == '127.0.0.1' ? 'localhost' : HOST}:${port}`);
	});
}


async function GETsql(req, res) {

	const dir = path.join(__dirname, decodeURI(req.vpath));
	
	try {
		const tab = req.query.tab;
		const db = req.query.db;
		const validColumns = (await mypg.tableColumnData(tab, db)).map(e => e.column_name);
		const requestedColumns = req.query.cols ? req.query.cols.split(',') : ['*'];
		const sanitizedColumns = requestedColumns.map(col => { return validColumns.includes(col.trim()) ? col.trim() : null; }).filter(col => col !== null);
		const cols = sanitizedColumns.length > 0 ? sanitizedColumns.join(', ') : '*';
		const where = req.query.where ? ` WHERE ${req.query.where.replaceAll(/\s*(?:;|ORDER\s+BY)[^]*/gi, '')}` : '';
		const ordering = req.query.order ? ` ORDER BY ${req.query.order.replaceAll(/\s*(?:;)[^]*/gi, '')}` : '';
		const query = `SELECT ${cols} FROM ${tab}${where}${ordering}`;
		const response = (await mypg.sendQuery(query, {database: db})).rows.slice(0, 2);
		//return res.send(response.map(e => `{${Object.entries(e).join('|')}}`).join("<br>").replaceAll(',', ': ').replaceAll('|', ', '));
		return res.json((await mypg.sendQuery(query, {database: db})).rows);
	} catch (err) {
		console.log(`Error: `, err);
		if (err instanceof ReferenceError && (err.message.indexOf('tab') > -1 || err.message.indexOf('db') > -1)) {
			let errString = `400 - Bad Request<br>`;
			if (err.message.indexOf('db') > -1) {
				errString += `No database requested<br>`;
			}
			if (err.message.indexOf('tab') > -1) {
				errString += `No table requested<br>`;
			}
			
			return res.status(400).send(errString);
		}
		return res.status(404).send(err);
	}
}

async function GETfile(req, res) {
	const fileData = [];
	
	const title = `Index of ${decodeURI(req.path)}`.replace(/\s\/(?<!$|\s+)/, ' ');

	//	href: `${req.protocol}://${req.headers.host}${req.path}`

	const dir = path.join(__dirname, decodeURI(req.vpath));

	try {
		const stats = await fs.stat(dir);
		if (stats.isDirectory()) {
			const files = await fs.readdir(dir);
			for (const file of files) {
				const filePath = path.join(dir, file);
				const fileStats = await fs.stat(filePath);
				let icon;
				if (fileStats.isDirectory()) {
					icon = '/icons/dir.gif';
				} else if (!fileStats.isFile()) {
					icon = '/icons/blank.gif';
				} else if (hasIcons && (await fs.readdir(path.join(__dirname, 'public/icons'))).includes(`${iconMap[getExtension(file)]}.gif`)) {
					icon = `/icons/${iconMap[getExtension(file)]}.gif`
				} else if (hasIcons && (await fs.readdir(path.join(__dirname, 'public/icons'))).includes(`${iconMap[getExtension(file)]}.png`)) {
					icon = `/icons/${iconMap[getExtension(file)]}.png`
				} else {
					icon = '/icons/blank.gif';//'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAC4jAAAuIwF4pT92AAAAC0lEQVQIW2NgAAIAAAUAAR4f7BQAAAAASUVORK5CYII=';
				}
				fileData.push({
					name: file,
					modified: fileStats.mtime,
					created: fileStats.birthtime,
					accessed: fileStats.atime,
					size: (fileStats.isFile() ? String(fileStats.size) : '-'),
					type: (fileStats.isFile() ? "file" : (fileStats.isDirectory() ? "directory" : "other")),
					icon: icon,
					extension: (fileStats.isFile() ? getExtension(file) : ''),
					dir: (req.path + '/').replaceAll('//', '/'),
				});
			}
		} else {
			const typeFromFile = await fileType.fromFile(dir);
			if (typeFromFile) { return res.sendFile(dir); }
			const fileBuffer = await fs.readFile(dir, 'utf8');
			try {
				let fileJson = JSON.parse(fileBuffer);
				const query = req.query;
				let commonKeys = getCommonKeys(fileJson, query);
				while (commonKeys.length) {
					for (const param of commonKeys) {
						fileJson = fileJson[param][req.query[param]];
						if (!fileJson) {
							return res.send({ Error: 'Data not found.' });
						} else {
							delete query[param];
						}
					}
					commonKeys = getCommonKeys(fileJson, query);
				}
				return res.json(fileJson);
			} catch (err) {
				return res.sendFile(dir);
			}
		}
	} catch (err) {
		console.log('Error: ', err);
		return res.status(404).send('404 - File Not Found');
	}
	
	
	fileData.sort(sortByProp('name'));
	fileData.sort(sortByProp('type'));
	
	
	if (req.query.sort !== undefined) {
		switch (req.query.sort) {
			case 'type':
				fileDate.sort(sortByProp('type'));
				break;
			default:
				fileData.sort(sortByProp('name'));
		}
	}
	
	if (req.path != '/') { fileData.unshift({ name: '../', modified: '', size: '', icon: '/icons/back.gif', dir: '', }); };
	
	return res.send(
		templateStrings[0] + title +
		templateStrings[1] + title +
		templateStrings[2] + fileData.map(getLine2).join('\n') +
		templateStrings[3]
	);
}

/*
async function handlePOST(req, res) {
	const dir = path.join(__dirname, decodeURI(req.vpath));
	try {
		let fileData = JSON.parse(await fs.readFile(dir, 'utf8'));
		let query = req.query;
		let commonKeys = getCommonKeys(fileData, query);
		while (commonKeys.length) {
			for (const param of commonKeys) {
				fileData = fileData[param][req.query[param]];
				if (!fileData) {
					return res.send({ Error: 'Data not found.' });
				} else {
					delete query[param];
				}
			}
			commonKeys = getCommonKeys(fileData, query);
		}
		return res.json(fileData);
	} catch (err) {
		console.log(err);
		return res.status(500).send({Error: 'Unable to process request.'});
	}
}
*/

function log(req, res, next) {
	const timestamp = formatDateString(new Date, Object.assign({...logOptions}, { year: undefined, }));
	if (req.ip !== lastConnectData.ip) {
		newline = true;
		clearTimeout(loggingTimeout);
		loggingTimeout = setTimeout(() => {newline = true}, 10000);
		lastConnectData.ip = req.ip;
	}
	console.log(`${newline ? '\n' : ''}${timestamp}| ${req.protocol.toUpperCase()} ${req.method} ~${decodeURI(req.vpath)} from ${req.ip}`);
	newline = false;
	clearTimeout(loggingTimeout);
	loggingTimeout = setTimeout(() => {newline = true}, 10000);
	next();
}

function getLine(file) {
	if (file.type == 'directory') {
		file.name += '/';
	}
	let line = `<a href="${file.dir}${encodeURI(file.name)}">${file.name}</a>`;
	line += ' '.repeat(68 - file.modified.length - file.name.length);
	line += file.modified;
	line += ' '.repeat(20 - file.size.length);
	line += file.size;
	return line;
}

function getLine2(file) {
	/*
	modified: formatDateString(fileStats.mtime).replaceAll(/:\d+$/g, ''),
	created: formatDateString(fileStats.birthtime).replaceAll(/:\d+$/g, ''),
	accessed: formatDateString(fileStats.atime).replaceAll(/:\d+$/g, ''),
	*/
	return `<tr><td valign="top" style="width: 22px;"><img src="${file.icon}" alt="[IMG]"></td><td style="width: calc(33.333333% - 8px);"><a href="${file.dir}${encodeURI(file.name)}">${file.name}</a></td><td align="right" style="width: calc(33.333333% - 8px);">${formatDateString(file.modified).replaceAll(/:\d+$/g, '')}</td><td align="right" style="width: calc(33.333333% - 8px);">${file.size}</td><td>&nbsp;</td></tr>`
}

function formatDateString(date = new Date, options = logOptions, locale = 'en-gb') {
	return date.toLocaleString(locale, options).replaceAll(', ', ',').replaceAll(' ', '-').replaceAll(',', ' ');
}

function getExtension(filename) {
	const arr = filename.split('.');
	return arr.length > 1 && (arr[0] || arr.length > 2) ? arr[arr.length - 1] : '';
}

function getDebugHTML(object, objectName = 'Object', prepend = '', depth = 0, maxdepth) {
	let totalHTML = '<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body style="color: white; background-color: rgb(20, 20, 20); line-height: 14pt; font-family: Comic Sans MS, Helvetica">';
	let innerHTML = `<p><span style="color: #ff4">${objectName.toUpperCase()}</span>`;
	for (let key in object) {
		innerHTML += '<br><br>';
		try {
			if (String(object[key].toString()) == '[object Object]' && depth < 3) {
				innerHTML += getDebugHTML(object[key], `${objectName}.${key}`, `${prepend}&#9;`, depth + 1, maxdepth).innerHTML;
			} else {
				innerHTML += `<span>${prepend}&#9;${objectName}[${key}] = ${object[key]}</span>`;
			}
		}
		catch (err) {innerHTML += `<span style="color: #f44;">${prepend}&#9;${objectName}[${key}] is not stringable.</span>`}
	}
	innerHTML += '</p>';
	totalHTML += innerHTML + '</body></html>';
	return {totalHTML: totalHTML, innerHTML: innerHTML};
}

function getCommonKeys(a, b) {
  const [k, j] = [Object.keys(a), Object.keys(b)];
  const [x, y] = k.length > j.length ? [j, a] : [k, b];
  return x.filter(e => e in y);
}

function sortByProp(prop) {
	return function (a,b) { return a[prop].toString().localeCompare(b[prop].toString()); };
}