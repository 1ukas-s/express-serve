
function hasFlag(...flagNames) {
	return flagNames.some((e) => { return (process.argv.indexOf(e) + process.argv.indexOf(`-${e}`)) > -1; });
}

function getValue(defaultValue, ...optionNames) {
	if (hasFlag(...optionNames)) {
		const idx = Math.max(...optionNames.map(e => process.argv.lastIndexOf(e)));
		return process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : defaultValue;
	}
	return defaultValue;
}

module.exports = { hasFlag, getValue }