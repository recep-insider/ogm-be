'use strict';

// BUG-095: deploy.sh geliştiricinin yerel node_modules'una dokunmaz; üretim paketleri repo dışında kurulur.

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '../../deploy.sh'), 'utf8');

describe('deploy.sh — yerel node_modules', () => {
  it('npm ci repo dizinini bağlamaz, repodaki node_modules silinmez', () => {
    expect(script).not.toMatch(/-v "\$LOCAL_REPO:\/app"/);
    expect(script).not.toMatch(/rm -rf node_modules/);
    expect(script).toMatch(/-v "\$BUILD_DIR:\/app"/);
  });

  it('yerel node_modules sunucuya gönderilmez; derlenen paketler ayrıca gider', () => {
    const excludes = script.match(/cat > "\$TMPDIR\/rsync-exclude" <<EOF\n([\s\S]*?)\nEOF/)[1].split('\n');
    expect(excludes).toContain('node_modules/');
    expect(script).toMatch(/run_rsync -az --delete "\$BUILD_DIR\/node_modules\/" "\$TARGET:\$DEPLOY_DIR\/node_modules\/"/);
  });
});
