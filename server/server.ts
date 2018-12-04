import express = require('express');
import path = require('path');
import compression = require('compression');
import fs = require('fs');
import { timer } from 'rxjs';
//
import { ProcessRunner } from './process-runner';
import { AngularCliProcessStatus } from './models/angular-cli-process-status.enum';
import { AngularProjectChecker } from './angular-project-checker';
import { printLogo } from './logo-printer.helper';
import { NgWizLogger } from './ngWizLogger';
import { CommandStatusResponse } from './models/command-status-response.interface';
import { IsAngularProjectResponse } from 'server/models/is-angular-project-response.interface';
import { GetProjectsResponse } from './models/get-projects-response.interface';
import { ngWizConfig } from './config/ng-wiz-config';

export function runServer(PORT: number, STATIC_FILES_LOCATION: string): Promise<express.Application> {
  const app: express.Application = express();
  const logger = new NgWizLogger('debug');
  const config = ngWizConfig();

  let ngServeCommandId = null;

  const processRunner = new ProcessRunner();

  app.use(compression());
  app.use(express.static(STATIC_FILES_LOCATION));
  app.use(express.json());       // to support JSON-encoded bodies
  app.use(express.urlencoded({ extended: true })); // to support URL-encoded bodies
  app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.get('/config', (req, res) => {
    logger.log.debug('Client request for config', config);
    res.send(config);
  });

  app.get('/isServing', (req, res) => {
    logger.log.debug(`Client ask if currently running "ng serve", answering ${!!ngServeCommandId}`);
    res.send(!!ngServeCommandId);
  });

  app.get('/isAngularProject', (req, res) => {
    logger.log.debug('Request to check if running inside an Angular Project');

    new AngularProjectChecker().check()
    .then(projectFolder => true, () => false)
    .then(result => res.send(<IsAngularProjectResponse>{
      isAngularProject: !!result,
      path: process.cwd()
    }));
  });

  app.get('/stopServing', (req, res) => {
    logger.log.debug(`Request to stop "ng serve" command`);
    if (processRunner.runningProcesses[ngServeCommandId]) {
      const commandPort = processRunner.runningProcesses[ngServeCommandId].command.match(/\s([0-9]{4,5})\s?/g)[0].replace(/\s/g, '');
      const killProcess = {
        id: 'killer',
        params: `for /f "tokens=5" %a in ('netstat -ano ^| find "${commandPort}" ^| find "LISTENING"') do taskkill /f /pid %a`
      };
      const ngServeStopper = timer(0, 500).subscribe(() => {
        if (processRunner.runningProcesses[ngServeCommandId].status === AngularCliProcessStatus.done) {
          processRunner.run(killProcess);
          processRunner.runningProcesses['killer'] = null;
          res.send();
          processRunner.runningProcesses[ngServeCommandId] = null;
          ngServeCommandId = null;
          ngServeStopper.unsubscribe();
        }
      });
    } else {
      logger.log.error(`Could not find "ng serve" command`);
      res.sendStatus(404);
    }
  });

  app.get('/projects', (req, res) => {
    const projects: string[] = [];
    const folderContent = fs.readdirSync(process.cwd());
    logger.log.debug(`Looking for Angular Projects under ${process.cwd()}`);

    folderContent.forEach(dirName => {
      const dirPath = process.cwd() + path.sep + dirName;
      logger.log.debug(`Attempting to acsses ${dirPath}`);
      try {
        if (fs.statSync(dirPath).isDirectory()) {
          const file = `${dirPath}${path.sep}angular.json`;
          fs.accessSync(file);
          projects.push(dirName);
          logger.log.debug(`Added "${dirName}" to projects array`);
        }
      } catch (error) {
        logger.log.warn(`Failed attempt to add "${dirName}" to projects array`);
      }
    });
    logger.log.info(`Available projects: [${projects.join(', ')}]`);
    res.send(<GetProjectsResponse>{projects: projects, path: process.cwd()});
  });

  app.get('/chooseProject', (req, res) => {
    const projectName = req.query.name;
    logger.log.debug(`Client ask to join project "${projectName}`);
    try {
      process.chdir(projectName);
      const projectPath = process.cwd();
      logger.log.debug(`Joined project "${projectName}", current directory ${projectPath}`);
      res.send({path: projectPath});
    } catch (error) {
      logger.log.error(`Unable to join project "${projectName}"`);
      logger.log.error(error);
      res.sendStatus(511);
    }
  });

  app.get('/keepAlive', (req, res) => {
    res.send(true);
  });

  app.get('/leaveProject', (req, res) => {
    const projectName = process.cwd().split(path.sep).pop();
    logger.log.debug('Client ask to leave current project');
    try {
      process.chdir('../');
      logger.log.debug(`left project "${projectName}", current directory ${process.cwd()}`);
      res.send();
    } catch (error) {
      logger.log.error(`Unable to leave project "${projectName}"`);
      logger.log.error(error);
      res.sendStatus(404);
    }
  });

  app.get('/status', (req, res) => {
    const id = req.query.id;

    if (processRunner.runningProcesses[id]) {
      const processStatus = processRunner.runningProcesses[id].status;
      const printableStatus = AngularCliProcessStatus[processStatus].toLocaleUpperCase();
      logger.log.debug(`Command status check - process ID: ${id} status: ${printableStatus}`);
      res.send(<CommandStatusResponse>{id: id, status: processStatus});
      if (processStatus === AngularCliProcessStatus.done
        && !processRunner.runningProcesses[id].command.includes('ng serve ')) {
        processRunner.runningProcesses[id] = null;
        logger.log.info(`Process ID: ${id} removed for the server`);
      }
    } else {
      logger.log.error(`Command status check failed - process ID ${id} not found`);
      res.send(<CommandStatusResponse>{id: id, status: AngularCliProcessStatus.error});
    }
  });

  app.post('/command', (req, res) => {

    const currentProcess = {
      id: ProcessRunner.guid(),
      params: req.body.command
    };

    if (currentProcess.params.includes('ng serve')) {
      ngServeCommandId = currentProcess.id;
    }

    try {
      logger.log.debug(`Running command: "${currentProcess.params}" under ID: [${currentProcess.id}]`);
      processRunner.run(currentProcess);
      res.send(currentProcess.id);
    } catch (error) {
      logger.log.error(`Command: "${currentProcess.params}" failed:`, error);
      res.status(400).end();
    }
  });

  // this function will help us in development using Postman to change the working directory
  app.post('/DEVchangeDir', (req, res) => {
    process.chdir(req.body.folder);
    res.send(`Working directory chaged to: ${process.cwd()}`);
  });

  app.get('*', (req, res) => {
    res.sendFile(`${STATIC_FILES_LOCATION}/index.html`);
  });

  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.clear();
      logger.log.clearContext();
      printLogo();
      // TODO: Add version/build number here
      logger.log.debug(`Listening on http://localhost:${PORT}`);

      resolve(app);
    });
  });
}
