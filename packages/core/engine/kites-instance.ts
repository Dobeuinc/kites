import * as appRoot from 'app-root-path';
import * as fs from 'fs';
import * as _ from 'lodash';
// import * as nconf from 'nconf';
import * as path from 'path';
import { Logger } from 'winston';

import { EventEmitter } from 'events';
import { ExtensionsManager } from '../extensions/extensions-manager';
import { createLogger } from '../logger';
import { EventCollectionEmitter } from './event-collection';

import { Type } from '@kites/common';
import { ExtensionDefinition, KitesExtension } from '../extensions/extensions';
import { Container } from '../injector';
import pkg from '../package.json';

/**
 * Kites callback on ready
 */
export type KitesReadyCallback = (kites: IKites) => void;

/**
 * Kites Options
 */
export interface IKitesOptions {
  [key: string]: any;
  providers?: Array<Type<any>>;
  discover?: boolean | string; // string for path discovery
  loadConfig?: boolean;
  rootDirectory?: string;
  appDirectory?: string;
  parentModuleDirectory?: string;
  env?: string;
  logger?: any;
  mode?: string;
  cacheAvailableExtensions?: any;
  tempDirectory?: string;
  extensionsLocationCache?: boolean;
}

/**
 * Kite Interface
 */
export interface IKites {
  [key: string]: any;
  name: string;
  version: string;
  options: IKitesOptions;
  initializeListeners: EventCollectionEmitter;
  isInitialized: boolean;
  logger: Logger;
  container: Container;
  afterConfigLoaded(fn: KitesReadyCallback): IKites;
  ready(callback: KitesReadyCallback): IKites;
  discover(option?: string | boolean): IKites;
  use(extension: KitesExtension | ExtensionDefinition): IKites;
  // useMany(extension: Array<KitesExtension | ExtensionDefinition>): IKites;
  init(): Promise<IKites>;
}

/**
 * Kites engine core
 */
export class KitesInstance extends EventEmitter implements IKites {

  [key: string]: any; // key allow assign any object to kites!
  name: string;
  version: string;
  options: IKitesOptions;
  initializeListeners: EventCollectionEmitter;
  extensionsManager: ExtensionsManager;
  logger: Logger;

  private fnAfterConfigLoaded: KitesReadyCallback;
  private isReady: Promise<KitesInstance>;
  private initialized: boolean;
  private iocContainer: Container;

  constructor(options?: IKitesOptions) {
    super();
    // It may possible cause memory leaks from extensions
    this.setMaxListeners(0);

    // setup kites
    this.name = pkg.displayName;
    this.version = pkg.version;
    this.options = Object.assign(this.defaults, options);
    this.initializeListeners = new EventCollectionEmitter();
    this.extensionsManager = new ExtensionsManager(this);
    this.initialized = false;
    this.iocContainer = new Container();

    // properties
    this.logger = createLogger(this.name);
    this.fnAfterConfigLoaded = () => this;
    this.isReady = new Promise((resolve) => {
      this.on('initialized', resolve);
    });

  }

  get container() {
    return this.iocContainer;
  }

  get isInitialized() {
    return this.initialized;
  }

  get defaults() {
    let parent = module.parent || module;
    return {
      appDirectory: appRoot.toString(),
      // TODO: separate kites discover as an api
      // EXAMPLE 1: kites.discover(true)
      // EXAMPLE 2: kites.discover(false)
      // EXAMPLE 3: kites.discover('/path/to/discover')
      discover: false,
      env: process.env.NODE_ENV || 'development',
      logger: {
        console: {
          level: 'debug',
          transport: 'console'
        }
      },
      parentModuleDirectory: path.dirname(parent.filename),
      rootDirectory: path.resolve(__dirname, '../../../'),
    };
  }

  get configFileName() {
    if (this.options.env === 'production') {
      return 'prod.config.json';
    } else if (this.options.env === 'test') {
      return 'test.config.json';
    } else {
      return 'dev.config.json';
    }
  }

  get defaultConfigFile() {
    return 'kites.config.json';
  }

  /**
   * Root directory - Used to searches extensions
   * Default in node_modules
   */
  get rootDirectory() {
    return this.options.rootDirectory;
  }

  /**
   * App directory - Used to seaches app configuration
   */
  get appDirectory() {
    return this.options.appDirectory || this.defaults.appDirectory;
  }

  /**
   * Parent module directory
   */
  get parentModuleDirectory() {
    return this.options.parentModuleDirectory || this.defaults.parentModuleDirectory;
  }

  /**
   * Get kites option or default value
   * @param option
   * @param defaultValue
   */
  defaultOption(option: string, defaultValue: any) {
    return this.options[option] || defaultValue;
  }

  /**
   * Get default path from appDirectory
   * @param {string} value
   */
  defaultPath(value: string) {
    if (typeof value === 'undefined') {
      return this.appDirectory;
    } else if (path.isAbsolute(value)) {
      return value;
    } else {
      return path.resolve(this.appDirectory, value);
    }
  }

  /**
   * Kites fire on ready
   * @param callback
   */
  ready(callback: KitesReadyCallback) {
    this.isReady.then((kites) => callback(kites));
    return this;
  }

  /**
   * Use a function as a kites extension
   * @param extension
   */
  use(extension: KitesExtension | ExtensionDefinition) {
    this.extensionsManager.use(extension);
    return this;
  }

  // useMany(extensions: Array<KitesExtension | ExtensionDefinition>) {
  //   this.extensionsManager.useMany(extensions);
  //   return this;
  // }

  /**
   * Enable auto discover extensions
   */
  discover(option: string | boolean) {
    if (typeof option === 'string') {
      this.options.discover = true;
      this.options.rootDirectory = option;
    } else if (typeof option === 'boolean') {
      this.options.discover = option;
    } else {
      this.options.discover = true;
    }
    return this;
  }

  /**
   * Thiết lập giá trị cấu hình cho các extensions
   * Example:
   *      .set('express:static', './assets') -> kites.options.express.static = './assets'
   * @param option
   * @param value
   */
  set(option: string, value: string) {
    const tokens = option.split(':');
    if (tokens.length === 2) {
      this.options[tokens[0]][tokens[1]] = value;
    } else if (tokens.length === 1) {
      this.options[tokens[0]] = value;
    }
  }

  /**
   * Assign config loaded callback
   * @param fn Function
   */
  afterConfigLoaded(fn: KitesReadyCallback) {
    this.fnAfterConfigLoaded = fn;
    return this;
  }

  /**
   * Kites initialize
   */
  async init() {
    this._initOptions();
    this.logger.info(`Initializing ${this.name}@${this.version} in mode "${this.options.env}"${this.options.loadConfig ? ', using configuration file ' + this.options.configFile : ''}`);

    if (this.options.logger && this.options.logger.silent === true) {
      this._silentLogs(this.logger);
    }

    await this.extensionsManager.init();
    await this.initializeListeners.fire();

    this.logger.info('kites initialized!');
    this.emit('initialized', this);

    this.initialized = true;
    return this;
  }

  private _initOptions() {
    if (this.options.loadConfig) {
      this._loadConfig();
      this.fnAfterConfigLoaded(this);
    }

    // return this._configureWinstonTransports(this.options.logger);
  }

  private _silentLogs(logger: Logger) {
    if (logger.transports) {
      _.keys(logger.transports).forEach((name) => {
        logger.transports[name].silent = true;
      });
    }
  }

  private _loadConfig() {
    var nconf = require('nconf');
    let nfn = nconf.argv()
      .env({
        separator: ':'
      })
      .env({
        separator: '_'
      })
      .defaults(this.options);

    if (!this.options.configFile) {

      this.options.configFile = this.configFileName;
      if (fs.existsSync(path.join(this.appDirectory, this.options.configFile))) {
        nfn.file({
          file: path.join(this.appDirectory, this.options.configFile)
        });
      } else if (fs.existsSync(path.join(this.appDirectory, this.defaultConfigFile))) {
        this.options.configFile = this.defaultConfigFile;
        nfn.file({
          file: path.join(this.appDirectory, this.defaultConfigFile)
        });
      }

    } else {
      let configFilePath = path.isAbsolute(this.options.configFile) ? this.options.configFile : path.join(this.appDirectory, this.options.configFile);

      if (!fs.existsSync(configFilePath)) {
        throw new Error('Config file ' + this.options.configFile + ' was not found.');
      } else {
        nfn.file({
          file: configFilePath
        });
      }
    }

    this.options = nconf.get();
  }

}
