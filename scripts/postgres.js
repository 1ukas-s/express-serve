const { Client } = require('pg');

const clientInfo = {
	host: 'localhost',
	port: 1850,
	user: 'postgres',
	password: 'abc',
	database: 'testdb',
}

function setdb(details) {
	Object.assign(clientInfo, details);
}

function getdb(db) {
	return db === undefined ? {database: clientInfo.database} : {database: db};
}

async function sendQuery(query, details = {}, log = false) {
	const client = new Client(Object.assign({}, clientInfo, details));
	let res;
	try {
		await client.connect();
		res = await client.query(query);
		if (log) { console.log('Query successful.') }
	} catch (err) {
		res = await err;
		if (log) { console.log('Query failed.') }
	} finally {
		client.end();
		return res;
	}
}

async function createDatabase(db) { return await sendQuery(`CREATE DATABASE ${db}`, {user: 'postgres', password: 'abc', database: 'postgres'}) }

async function dropDatabase(db) { return await sendQuery(`DROP DATABASE ${db}`, {user: 'postgres', password: 'abc', database: 'postgres'}) }

// e.g., CREATE TABLE tab (col1 TEXT PRIMARY KEY, col2 INTEGER, col3 JSON)
async function createTable(tab, cols, db) { return await sendQuery(`CREATE TABLE ${tab} (${Object.entries(cols).map(e => `${e[0]} ${e[1]}`)})`, getdb(db)) }

async function dropTable(tab) { return await sendQuery(`DROP TABLE ${tab}`, getdb(db)) }

async function addRows(tab, rows, db) {
	const cols = rows.shift();
	let query = `INSERT INTO ${tab} (${cols.join(', ')}) VALUES `
	for (const row of rows) {
		if (row.length != cols.length) { console.error(`Invalid query. Row ${row} did not have the same number of entries as column description ${cols}`); return; }
		query += '(';
		for (const col in cols) {
			query += `${types[row[col] === null ? null : typeof(row[col])](row[col])}, `;
		}
		query = query.replace(/,\s*$/g, '), ');
	}
	query = query.replace(/,\s*$/g, '');
	console.log(query);
	return await sendQuery(query, getdb(db), );
}

function dataToString(e) {
	if (e === null) {
		return `null`;
	} else if (e instanceof Array) {
		return e.length > 0 ? `ARRAY [${e.map(dataToString)}]` : `ARRAY[]::VARCHAR[]`;
	}
	
	switch (typeof(e)) {
		case 'number':
			return `${e}`;
		case 'string':
			return `E'${e.replaceAll("'", "\\'")}'`;
		case 'object':
			return `'${JSON.stringify(e).replaceAll("'", "''")}'`;
	}
}

async function addRowsFromObjects(tab, cols, rows, db) {
	const completed = (await sendQuery(`SELECT kanji FROM ${tab}`, getdb(db))).rows.map(e => e.kanji);
	const rows_ = rows.filter(e => !completed.includes(e.kanji))
	const total = rows_.length;
	let i = 0;
	let skipped = 0;
	for (const row of rows_) {
		if (row.english.length < 1 || Object.keys(row.kunyomi).length + Object.keys(row.onyomi).length < 1) {skipped += 1; continue}
		i += 1;
		const query = `INSERT INTO ${tab} (${cols.join(', ')}) VALUES (${cols.map(col => dataToString(row[col])).join(', ')})`
		if (i%10 < 1) { console.log(`${row[cols[0]]} (${i}/${total - skipped}): ${query.substring(0, 20)} on ${getdb(db).database}`) }
		await sendQuery(query, getdb(db));
	}
	return undefined;
}

async function tableColumnData(tab, db) {
	const val = await sendQuery(`
SELECT 
	a.attname AS column_name,
	CASE 
		WHEN i.indisprimary THEN true
		ELSE false
	END AS primary_key,
	t.typname AS type
FROM 
	pg_attribute a
LEFT JOIN 
	pg_index i ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) AND i.indisprimary
JOIN 
	pg_type t ON a.atttypid = t.oid
WHERE 
	a.attrelid = '${tab}'::regclass
	AND a.attnum > 0
	AND NOT a.attisdropped
ORDER BY 
	a.attnum`, getdb(db));
	return val.rows;
}

async function setReadPerm(tab, value = true, db) {
	const perm = value ? `GRANT` : `REVOKE`;
	return undefined !== await sendQuery(`
${perm} CONNECT ON DATABASE ${getdb(db).database} TO readonly_user;
${perm} USAGE ON SCHEMA public TO readonly_user;
${perm} SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;`, getdb(db));
}

module.exports = { sendQuery, createDatabase, dropDatabase, createTable, dropTable, addRows, addRowsFromObjects, tableColumnData, dataToString, setReadPerm, setdb }