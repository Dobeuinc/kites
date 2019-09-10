import { EventEmitter } from 'events';
import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';
import { IKites } from '..';
import { discover, DiscoverOptions } from './discover';
import { ExtensionDefinition, ExtensionOptions, KitesExtension } from './extensions';
import sorter from './sorter';

class ExtensionsManager extends EventEmitter {
  protected kites: IKites;
  protected availableExtensions: KitesExtension[];
  protected usedExtensions: KitesExtension[];

  constructor(kites: IKites) {
    super();

    this.kites = kites;
    this.availableExtensions = [];
    this.usedExtensions = [];
  }

  /**
   * Get enabled available extensions
   */
  get extensions() {
    return this.availableExtensions.filter((e) => !e.options || e.options.enabled !== false);
  }

  /**
   * Use a kites extension
   * @param extension
   */
  use(extension: KitesExtension | ExtensionDefinition) {
    if (typeof extension === 'function') {
      this.usedExtensions.push({
        dependencies: [],
        directory: this.kites.options.parentModuleDirectory,
        main: extension,
        name: extension.name || '<no-name>',
      });
    } else {
      this.usedExtensions.push(extension);
    }
  }

  useMany(extensions: KitesExtension[]) {
    var promises = extensions.map((e) => this.useOne(e));
    return Promise.all(promises);
  }

  useOne(extension: KitesExtension) {
    // extends options
    // Review _.assign(), _.defaults(), or _.merge?
    const options = _.assign<
      ExtensionOptions,
      ExtensionOptions | undefined,
      ExtensionOptions | undefined>({}, extension.options, this.kites.options[extension.name && extension.name.toLowerCase()]);
    extension.options = options;

    if (options.enabled === false) {
      this.kites.logger.debug(`Extension ${extension.name} is disabled, skipping`);
      return Promise.resolve();
    }

    return Promise.resolve()
      .then(() => {
        if (typeof extension.main === 'function') {
          (extension.main as Function).call(this, this.kites, extension);
          return Promise.resolve();
        } else if (typeof extension.main === 'string' && extension.directory) {
          // TODO: REMOVE, reason: Un-Support
          let extPath = path.join(extension.directory, extension.main);
          let extModule = require(extPath);
          extModule.call(this, this.kites, extension);
          return Promise.resolve();
        } else if (typeof extension.init === 'function') {
          (extension.init as Function).call(this, this.kites, extension);
          return Promise.resolve();
        } else {
          return Promise.reject('Invalid kites extension: ' + extension.name);
        }
      })
      .then(() => {
        if (options.enabled !== false) {
          this.emit('extension:registered', extension);
        } else {
          this.kites.logger.debug(`Extension ${extension.name} was disabled`);
        }
      })
      .catch((e: Error) => {
        let errorMsg;

        if (!extension.name) {
          errorMsg = `Error when loading anonymous extension ${extension.directory != null ? ` at ${extension.directory}` : ''}${os.EOL}${e.stack}`;
        } else {
          errorMsg = `Error when loading extension ${extension.name}${os.EOL}${e.stack}`;
        }

        this.kites.logger.error(errorMsg);
        throw new Error(errorMsg);
      });
  }

  /**
   * Initialize extensions manager
   */
  async init() {
    this.availableExtensions = [];

    let autodiscover = false;
    if (this.kites.options.discover === 'undefined') {
      this.kites.options.discover = [false, 0];
    } else if (typeof this.kites.options.discover === 'boolean') {
      this.kites.options.discover = [this.kites.options.discover, 2, this.kites.options.appDirectory];
    } else if (typeof this.kites.options.discover === 'string') {
      this.kites.options.discover = [true, 2, this.kites.options.discover];
    }

    // autodiscover extensions
    autodiscover = this.kites.options.discover.shift() as boolean;

    if (autodiscover) {
      let depth = this.kites.options.discover.shift() as number;
      let directories = this.kites.options.discover as string[];
      let extensions = await discover({
        cacheAvailableExtensions: this.kites.options.cacheAvailableExtensions,
        extensionsLocationCache: this.kites.options.extensionsLocationCache,
        logger: this.kites.logger,
        env: this.kites.options.env,
        depth: depth,
        rootDirectory: directories,
        tempDirectory: this.kites.options.tempDirectory,
      });
      this.kites.logger.debug('Discovered ' + extensions.length + ' extensions');
      this.availableExtensions = this.availableExtensions.concat(extensions);
    } else {
      this.kites.logger.debug('Autodiscover is not enabled!');
    }
    // filter extensions will be loaded?
    this.availableExtensions = this.availableExtensions.concat(this.usedExtensions);
    if (this.kites.options.extensions) {
      let allowedExtensions = this.kites.options.extensions as string[];
      this.availableExtensions = this.availableExtensions.filter(e => allowedExtensions.indexOf(e.name) > -1);
    }

    this.availableExtensions.sort(sorter);
    return this.useMany(this.availableExtensions);

  }
}

export {
  ExtensionsManager,
  DiscoverOptions
};
