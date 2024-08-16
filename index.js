const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fileType = require('file-type');
const { client } = require('pg');
const mypostgres = require('./postgres.js');

const PORT = 3000;
const HOST = '0.0.0.0';
const app = express();

const templateStrings = [
	'<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"><title>',
	'</title></head><body style="color: rgb(210, 210, 210); background-color: rgb(20, 20, 20);"><h1>',
	'</h1><hr><pre>',
	'</pre></body></html>'
]

app.listen(PORT, HOST);
console.log(`Server started on ${HOST == '0.0.0.0' || HOST == '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);


app.get('*/sql/*', GETsql);
app.get('/public/*', GETfile);
app.get('*', (req, res) => {
	res.send(`<!DOCTYPE html><html lang="en"><head><meta http-equiv="refresh" content="0; URL=${req.protocol}://${req.headers.host}/public${req.originalUrl}"></head></html>`)
});
//app.post('*', handlePOST);

function getLine(file, href) {
	if (file.type == 'directory') {
		file.name += '/';
	}
	let line = '<a href="' + href + encodeURI(file.name) + '">' + file.name + '</a>';
	line += ' '.repeat(68 - file.modified.length - file.name.length);
	line += file.modified;
	line += ' '.repeat(20 - file.size.length);
	line += file.size;
	return line;
}

function formatDateString(dateString) {
	const date = dateString.toString().split(' ').splice(1, 4);
	const time = date.pop().split(':'); time.pop();
	date.push(date.reverse().shift());
	return date.join('-') + ' ' + time.join(':');
}

function getExtension(filename) {
	const arr = filename.split('.');
	return arr.length > 1 && (arr[0] || arr.length > 2) ? arr[arr.length - 1] : '';
}

async function GETsql(req, res) {

	const dir = path.join(__dirname, decodeURI(req.path));
	
	try {
		const tab = dir.match(/(?<=sql\/).*/)[0].split('/');
		const validColumns = await mypostgres.tableColumnData(tab[0], tab[1]);
		const requestedColumns = req.query.columns ? req.query.columns.split(',') : ['*'];
		const sanitizedColumns = requestedColumns.map(col => {return validColumns.includes(col.trim()) ? col.trim() : null}).filter(col => col !== null);
		const columns = sanitizedColumns.length > 0 ? sanitizedColumns.join(', ') : '*';
		let where = '';
		if (req.query.hasOwnProperty('where')) {
			where = `WHERE ${req.query.where}`;
		}
		const query = `SELECT ${columns} FROM ${tab[1]} ${where}`;
		return res.json((await mypostgres.sendQuery(tab[0], query)).rows);
	} catch (err) {
		console.log('Error: ', err);
		return res.status(404).send('404 - File Not Found');
	}
}

async function GETfile(req, res) {
	let fileData = [{
		name: '../',
		modified: '',
		size: '',
	}];
	
	const indexStrings = {
		title: `Index of ${decodeURI(req.originalUrl)}`,
		header: `Index of ${decodeURI(req.originalUrl)}`,
		href: `${req.protocol}://${req.headers.host}${req.originalUrl}`,
	};

	const dir = path.join(__dirname, decodeURI(req.path));
	
	try {
		let stats = await fs.stat(dir);
		if (stats.isDirectory()) {
			let files = await fs.readdir(dir);
			for (const file of files) {
				let filePath = path.join(dir, file);
				let fileStats = await fs.stat(filePath);
				fileData.push({
					name: file,
					modified: formatDateString(fileStats.mtime.toString()),
					created: formatDateString(fileStats.birthtime.toString()),
					accessed: formatDateString(fileStats.atime.toString()),
					size: (fileStats.isFile() ? String(fileStats.size) : '-'),
					type: (fileStats.isFile() ? "file" : (fileStats.isDirectory() ? "directory" : "other")),
					extension: (fileStats.isFile() ? getExtension(file) : ''),
				});
			}
		} else {
			const typeFromFile = await fileType.fromFile(dir);
			if (typeFromFile) {return res.sendFile(dir)}
			const fileBuffer = await fs.readFile(dir, 'utf8');
			try {
				let fileData = JSON.parse(fileBuffer);
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
				return res.sendFile(dir);
			}
		}
	} catch (err) {
		console.log('Error: ', err);
		return res.status(404).send('404 - File Not Found');
	}
	
	return res.send(
		templateStrings[0] +
		indexStrings.title +
		templateStrings[1] +
		indexStrings.header +
		templateStrings[2] +
		fileData.map((e, i) => getLine(e, indexStrings.href)).join('\n') +
		templateStrings[3]
	);
}

/*
async function handlePOST(req, res) {
	const dir = path.join(__dirname, decodeURI(req.path));
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

function getDebugHTML(object, objectName = 'Object', prepend = '', depth = 0) {
	let totalHTML = '<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=UTF-8"></head><body style="color: white; background-color: rgb(20, 20, 20); line-height: 14pt; font-family: Comic Sans MS, Helvetica">';
	let innerHTML = `<p><span style="color: #ff4">${objectName.toUpperCase()}</span>`;
	for (let key in object) {
		innerHTML += '<br><br>';
		try {
			if (String(object[key].toString()) == '[object Object]' && depth < 3) {
				innerHTML += getDebugHTML(object[key], `${objectName}.${key}`, `${prepend}&#9;`, depth + 1).innerHTML;
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
