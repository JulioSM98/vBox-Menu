import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import GObject from 'gi://GObject'
import St from 'gi://St'


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const TEXT_VBOXAPP = 'vBox Menu';
const TEXT_LOGID = 'vBox-Menu';
const ICON_SIZE = 22;
const DEBUG = false;

const SETTING_HEADLESS = 'headless';
const SETTING_DETACHABLE = 'detachable';

let settings;
let sourceId1 = null;
let sourceId2 = null;
let sourceId3 = null;

class VBoxMenuBtn extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(path, name) {
        super(0.0, name);

        this._textdecoder = new TextDecoder();
        this._populated = false;
        this._menuitems = [];
        let gicon = Gio.icon_new_for_string(path + '/icons/vbox-icon.svg');
        let icon = new St.Icon({ gicon: gicon, icon_size: ICON_SIZE });
        this.add_child(icon);

        this._tmpItem = new PopupMenu.PopupMenuItem('...');
        this.menu.addMenuItem(this._tmpItem);

        this.menu.actor.connect('notify::visible', this._onVisibilityChanged.bind(this));
        sourceId3 = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, this._populateMenu.bind(this));
    }

    _startVbox() {
        GLib.spawn_command_line_async('virtualbox');
    };

    _startVM(name, id) {
        if (this._isVMRunning(id)) {
            this._activateWindow(name);
        }
        else {
            let headless = settings.get_boolean(SETTING_HEADLESS);
            let detachable = settings.get_boolean(SETTING_DETACHABLE);

            GLib.spawn_command_line_async('vboxmanage startvm ' + id + (headless ? ' --type headless' : detachable ? ' --type separate' : ''));
        }
    };


    _toggleHeadless(menuitemHeadless, menuitemDetachable) {
        let headless = settings.get_boolean(SETTING_HEADLESS);
        menuitemHeadless.setToggleState(!headless);
        settings.set_boolean(SETTING_HEADLESS, !headless);
        if (!headless) {
            menuitemDetachable.setToggleState(true);
            settings.set_boolean(SETTING_DETACHABLE, true);
        }

    };

    _toggleDetachable(menuitemDetachable, menuitemHeadless) {
        let detachable = settings.get_boolean(SETTING_DETACHABLE);
        menuitemDetachable.setToggleState(!detachable);
        settings.set_boolean(SETTING_DETACHABLE, !detachable);
        if (detachable) {
            menuitemHeadless.setToggleState(false);
            settings.set_boolean(SETTING_HEADLESS, false);
        }
    };

    _getInfoVM(idVM) {
        let cmd = "vboxmanage showvminfo " + idVM;
        this._log('Run \'' + cmd + '\'');
        let file = Gio.file_new_tmp(null);
        file[1].get_output_stream().write(GLib.spawn_command_line_sync(cmd)[1], null);
        let data = this._textdecoder.decode(GLib.spawn_command_line_sync('grep "Guest OS" ' + file[0].get_path())[1]);
        let os = data.split(':')[1].replace(" ", '');
        return os.trim();
    }

    _parseVMList(vms) {
        let res = [];
        if (vms.length !== 0) {
            let machines = vms.toString().split('\n');
            for (let i = 0; i < machines.length; i++) {
                let machine = machines[i];
                if (machine === '') {
                    continue;
                }

                let info = machine.split('" {');
                let name = info[0].replace('"', '');
                let id = info[1].replace('}', '');

                this._log('Machine name: ' + name + ', ID: ' + id);

                res.push({ name: name, id: id });
            }
            for (let i = 0; i < res.length; i++) {
                let id = res[i].id;
                let data = this._getInfoVM(id);
                res[i].os = data;
            }
        }

        return res;
    };

    _populateMenu() {
        this._menuitems = [];
        this.menu.removeAll();

        let vms;
        let headless = settings.get_boolean(SETTING_HEADLESS);
        let detachable = settings.get_boolean(SETTING_DETACHABLE);

        try {
            let cmd = 'vboxmanage list vms';
            this._log('Run \'' + cmd + '\'');
            vms = this._textdecoder.decode(GLib.spawn_command_line_sync(cmd)[1]);
        }
        catch (err) {
            this._log(err);
            Main.notifyError(TEXT_VBOXAPP + ': ' + err);
            return;
        }

        let machines = this._parseVMList(vms);

        if (machines.length !== 0) {
            for (let i = 0; i < machines.length; i++) {
                let name = machines[i].name;
                let id = machines[i].id;
                let os = machines[i].os;

                let menuitem = new PopupMenu.PopupMenuItem(name + ' - ' + os);
                menuitem.setOrnament(PopupMenu.Ornament.NONE);
                menuitem._vmid = id;
                menuitem.connect('activate', this._startVM.bind(this, name, id));
                this.menu.addMenuItem(menuitem);
                this._menuitems.push(menuitem);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let menuitemHeadless = new PopupMenu.PopupSwitchMenuItem('Headless', headless);
        let menuitemDetachable = new PopupMenu.PopupSwitchMenuItem('Detachable', detachable);

        menuitemHeadless.connect('toggled', this._toggleHeadless.bind(this, menuitemHeadless, menuitemDetachable));
        this.menu.addMenuItem(menuitemHeadless);

        menuitemDetachable.connect('toggled', this._toggleDetachable.bind(this, menuitemDetachable, menuitemHeadless));
        this.menu.addMenuItem(menuitemDetachable);

        let menuitemStartVBox = new PopupMenu.PopupMenuItem('VirtualBox...');
        menuitemStartVBox.connect('activate', this._startVbox.bind(this));
        this.menu.addMenuItem(menuitemStartVBox);

        this._populated = true;

        this._onVisibilityChanged();

        return false;
    }

    _log(text) {
        if (DEBUG) {
            console.log(TEXT_LOGID, text);
        }

    }

    _isVMRunning(id) {
        let machines = this._getRunningVMs();
        return this._searchInVMs(machines, id);
    }

    _getRunningVMs() {
        let vms;
        try {
            this._log('Run \'vboxmanage list runningvms\'');
            vms = this._textdecoder.decode(GLib.spawn_command_line_sync('vboxmanage list runningvms')[1]);
        }
        catch (err) {
            this._log(err);
            return;
        }

        return this._parseVMList(vms);
    }

    _onVisibilityChanged() {
        if (this.menu.actor.visible && this._populated) {
            sourceId2 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, this._markRunning.bind(this));
        }
    }

    _markRunning() {
        let machines = this._getRunningVMs();

        for (var i = 0; i < this._menuitems.length; i++) {
            let running = this._searchInVMs(machines, this._menuitems[i]._vmid);
            this._menuitems[i].setOrnament(running ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
        return false;
    }

    _searchInVMs(machines, id) {
        for (var i = 0; i < machines.length; i++) {
            if (machines[i].id === id) {
                return true;
            }
        }
        return false;
    }

    _activateWindow(name) {
        let a = global.get_window_actors();
        for (var i = 0; i < a.length; i++) {
            let mw = a[i].metaWindow;
            let title = mw.get_title();

            if (title.startsWith(name) && title.toLowerCase().includes('virtualbox')) {
                this._log('activate window: ' + title);
                mw.activate(global.get_current_time());
            }
        }
    }
}

export default class VBoxMenu extends Extension {
    enable() {
        settings = this.getSettings();
        this._vboxapplet = new VBoxMenuBtn(this.path, this.name);
        Main.panel.addToStatusArea(this.uuid, this._vboxapplet);
    }

    disable() {
        // GS guidelines requirements
        if (sourceId1) {
            GLib.Source.remove(sourceId1);
            sourceId1 = null;
        }
        if (sourceId2) {
            GLib.Source.remove(sourceId2);
            sourceId2 = null;
        }
        if (sourceId3) {
            GLib.Source.remove(sourceId3);
            sourceId3 = null;
        }

        this._vboxapplet.destroy();
        settings = null;
        this._vboxapplet = null;
    }
}