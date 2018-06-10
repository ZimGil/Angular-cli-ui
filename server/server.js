const express = require('express');
const path = require('path');
const compression = require('compression');
const childProcess = require('child_process');

const app = express();
const STATIC_FILES_LOCATION = path.join(__dirname, '..', '/dist/Angular-cli-ui');
const PORT = 3000;

let isOpenBrowser;

process.argv.forEach((val, index, array) => {
  if (val === '-o') {
    isOpenBrowser = true;
  }
});

app.use(compression());
app.use(express.static(STATIC_FILES_LOCATION));
app.use(express.json());       // to support JSON-encoded bodies
app.use(express.urlencoded()); // to support URL-encoded bodies

app.get('/', (req, res) => {
  res.sendFile(`${STATIC_FILES_LOCATION}/index.html`);
});

app.post('/command', (req, res) => {
  try {
    process.chdir(req.body.folder);

    const commandEvent = childProcess.exec(req.body.command, (err, stdout, stderr) => {
      if (err) {
        console.log(err);
        return;
      }
    });

    commandEvent.stdout.on('data', (data) => {
      console.log(data); 
    });
  
    commandEvent.stdout.on('close', () => {
      console.log("###################################################################################");
    })
    
    res.send('thanks for this data');  
  }
  catch(error) {
    console.log(error);
    res.status(400).end();
  }
});

app.listen(PORT, () => {
  console.clear();
  console.log(`Listening on port ${PORT}!`);
  if (isOpenBrowser) {
    openBrowser(PORT);
  }
});

function openBrowser(port) {
  const url = `http://localhost:${port}`;
  const start = process.platform === 'darwin'? 'open': process.platform === 'win32'? 'start': 'xdg-open';

  childProcess.exec(`${start} ${url}`);
}
