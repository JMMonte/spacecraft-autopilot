// Import the fs module
const fs = require('fs');
const unzipper = require('unzipper');

const filePath = 'src/images/spacePanorama-caspianSea.exr.zip';
const extractPath = 'src/images/';

fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
        console.log('File does not exist');
    } else if (!filePath.endsWith('.zip')) {
        console.log('File is not a zip file');
    } else {
        fs.createReadStream(filePath)
            .pipe(unzipper.Extract({ path: extractPath }))
            .on('close', () => console.log('File unzipped successfully'));
    }
});
