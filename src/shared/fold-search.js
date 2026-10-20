'use strict';

// "ELIF" (İngilizce klavye) ile "Elif" eşleşsin: Türkçe küçük harfte I → ı olur, ı da i sayılır.
const foldSearch = (value) => value.toLocaleLowerCase('tr').replace(/ı/g, 'i');

module.exports = { foldSearch };
