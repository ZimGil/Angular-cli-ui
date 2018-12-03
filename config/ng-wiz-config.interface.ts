export interface NgWizConfig {
  // The port ngWiz server is listening to.
port: number;

// Launch ngWiz browser window when ngWiz starts.
launchBrowser: boolean;

// Directory to output log files.
logDirectory: string;

// Date format for logging.
logDateFormat: string;
}