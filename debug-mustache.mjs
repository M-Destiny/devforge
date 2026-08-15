import * as M from 'mustache';
console.log('namespace keys:', Object.keys(M));
console.log('M.render:', typeof M.render);
console.log('M.default:', typeof M.default);
if (M.default) {
  console.log('M.default.render:', typeof M.default.render);
}
