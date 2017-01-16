/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import Event, { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import * as browser from 'vs/base/browser/browser';
import { CommonEditorConfiguration } from 'vs/editor/common/config/commonEditorConfig';
import { IDimension } from 'vs/editor/common/editorCommon';
import { FontInfo, BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { FastDomNode } from 'vs/base/browser/styleMutator';

class CSSBasedConfigurationCache {

	private _keys: { [key: string]: BareFontInfo; };
	private _values: { [key: string]: FontInfo; };

	constructor() {
		this._keys = Object.create(null);
		this._values = Object.create(null);
	}

	public has(item: BareFontInfo): boolean {
		return !!this._values[item.getId()];
	}

	public get(item: BareFontInfo): FontInfo {
		return this._values[item.getId()];
	}

	public put(item: BareFontInfo, value: FontInfo): void {
		this._keys[item.getId()] = item;
		this._values[item.getId()] = value;
	}

	public getKeys(): BareFontInfo[] {
		return Object.keys(this._keys).map(id => this._keys[id]);
	}
}

export function readFontInfo(bareFontInfo: BareFontInfo): FontInfo {
	return CSSBasedConfiguration.INSTANCE.readConfiguration(bareFontInfo);
}

class CSSBasedConfiguration extends Disposable {

	public static INSTANCE = new CSSBasedConfiguration();

	private _cache: CSSBasedConfigurationCache;
	private _changeMonitorTimeout: number = -1;

	private _onDidChange = this._register(new Emitter<void>());
	public onDidChange: Event<void> = this._onDidChange.event;

	constructor() {
		super();

		this._cache = new CSSBasedConfigurationCache();
	}

	public dispose(): void {
		if (this._changeMonitorTimeout !== -1) {
			clearTimeout(this._changeMonitorTimeout);
			this._changeMonitorTimeout = -1;
		}
		super.dispose();
	}

	public readConfiguration(bareFontInfo: BareFontInfo): FontInfo {
		if (!this._cache.has(bareFontInfo)) {
			let readConfig = CSSBasedConfiguration._actualReadConfiguration(bareFontInfo);

			if (readConfig.typicalHalfwidthCharacterWidth <= 2 || readConfig.typicalFullwidthCharacterWidth <= 2 || readConfig.spaceWidth <= 2 || readConfig.maxDigitWidth <= 2) {
				// Hey, it's Bug 14341 ... we couldn't read
				readConfig = new FontInfo({
					fontFamily: readConfig.fontFamily,
					fontWeight: readConfig.fontWeight,
					fontSize: readConfig.fontSize,
					lineHeight: readConfig.lineHeight,
					isMonospace: readConfig.isMonospace,
					typicalHalfwidthCharacterWidth: Math.max(readConfig.typicalHalfwidthCharacterWidth, 5),
					typicalFullwidthCharacterWidth: Math.max(readConfig.typicalFullwidthCharacterWidth, 5),
					spaceWidth: Math.max(readConfig.spaceWidth, 5),
					maxDigitWidth: Math.max(readConfig.maxDigitWidth, 5),
				});
				this._installChangeMonitor();
			}

			this._cache.put(bareFontInfo, readConfig);
		}
		return this._cache.get(bareFontInfo);
	}

	private _installChangeMonitor(): void {
		if (this._changeMonitorTimeout === -1) {
			this._changeMonitorTimeout = setTimeout(() => {
				this._changeMonitorTimeout = -1;
				this._monitorForChanges();
			}, 500);
		}
	}

	private _monitorForChanges(): void {
		let shouldInstallChangeMonitor = false;
		let keys = this._cache.getKeys();
		for (let i = 0; i < keys.length; i++) {
			let styling = keys[i];

			let newValue = CSSBasedConfiguration._actualReadConfiguration(styling);

			if (newValue.typicalHalfwidthCharacterWidth <= 2 || newValue.typicalFullwidthCharacterWidth <= 2 || newValue.maxDigitWidth <= 2) {
				// We still couldn't read the CSS config
				shouldInstallChangeMonitor = true;
			} else {
				this._cache.put(styling, newValue);
				this._onDidChange.fire();
			}
		}
		if (shouldInstallChangeMonitor) {
			this._installChangeMonitor();
		}
	}

	private static _actualReadConfiguration(bareFontInfo: BareFontInfo): FontInfo {
		let canvasElem = <HTMLCanvasElement>document.createElement('canvas');
		let context = canvasElem.getContext('2d');

		let getCharWidth = (char: string): number => {
			return context.measureText(char).width;
		};

		context.font = `normal normal normal normal ${bareFontInfo.fontSize}px / ${bareFontInfo.lineHeight}px ${bareFontInfo.fontFamily}`;
		const typicalHalfwidthCharacter = getCharWidth('n');
		const typicalFullwidthCharacter = getCharWidth('\uff4d');

		let isMonospace = true;
		let monospaceWidth = typicalHalfwidthCharacter;

		let getCharWidthAndCheckMonospace = (char: string): number => {
			const charWidth = getCharWidth(char);
			if (isMonospace) {
				const diff = typicalHalfwidthCharacter - charWidth;
				if (diff < -0.001 || diff > 0.001) {
					isMonospace = false;
				}
			}
			return charWidth;
		};

		let checkMonospace = (char: string): void => {
			if (isMonospace) {
				const charWidth = getCharWidth(char);
				const diff = typicalHalfwidthCharacter - charWidth;
				if (diff < -0.001 || diff > 0.001) {
					isMonospace = false;
				}
			}
		};

		monospaceWidth = typicalHalfwidthCharacter;

		const space = getCharWidthAndCheckMonospace(' ');
		const digit0 = getCharWidthAndCheckMonospace('0');
		const digit1 = getCharWidthAndCheckMonospace('1');
		const digit2 = getCharWidthAndCheckMonospace('2');
		const digit3 = getCharWidthAndCheckMonospace('3');
		const digit4 = getCharWidthAndCheckMonospace('4');
		const digit5 = getCharWidthAndCheckMonospace('5');
		const digit6 = getCharWidthAndCheckMonospace('6');
		const digit7 = getCharWidthAndCheckMonospace('7');
		const digit8 = getCharWidthAndCheckMonospace('8');
		const digit9 = getCharWidthAndCheckMonospace('9');
		const maxDigitWidth = Math.max(digit0, digit1, digit2, digit3, digit4, digit5, digit6, digit7, digit8, digit9);

		// monospace test: used for whitespace rendering
		checkMonospace('→');
		checkMonospace('·');

		// monospace test: some characters
		checkMonospace('|');
		checkMonospace('/');
		checkMonospace('-');
		checkMonospace('_');
		checkMonospace('i');
		checkMonospace('l');
		checkMonospace('m');

		context.font = `italic normal normal normal ${bareFontInfo.fontSize}px / ${bareFontInfo.lineHeight}px ${bareFontInfo.fontFamily}`;
		checkMonospace('|');
		checkMonospace('_');
		checkMonospace('i');
		checkMonospace('l');
		checkMonospace('m');
		checkMonospace('n');

		context.font = `normal normal bold normal ${bareFontInfo.fontSize}px / ${bareFontInfo.lineHeight}px ${bareFontInfo.fontFamily}`;
		checkMonospace('|');
		checkMonospace('_');
		checkMonospace('i');
		checkMonospace('l');
		checkMonospace('m');
		checkMonospace('n');

		return new FontInfo({
			fontFamily: bareFontInfo.fontFamily,
			fontWeight: bareFontInfo.fontWeight,
			fontSize: bareFontInfo.fontSize,
			lineHeight: bareFontInfo.lineHeight,
			isMonospace: isMonospace,
			typicalHalfwidthCharacterWidth: typicalHalfwidthCharacter,
			typicalFullwidthCharacterWidth: typicalFullwidthCharacter,
			spaceWidth: space,
			maxDigitWidth: maxDigitWidth
		});
	}
}

export class Configuration extends CommonEditorConfiguration {

	public static applyFontInfoSlow(domNode: HTMLElement, fontInfo: BareFontInfo): void {
		domNode.style.fontFamily = fontInfo.fontFamily;
		domNode.style.fontWeight = fontInfo.fontWeight;
		domNode.style.fontSize = fontInfo.fontSize + 'px';
		domNode.style.lineHeight = fontInfo.lineHeight + 'px';
	}

	public static applyFontInfo(domNode: FastDomNode, fontInfo: BareFontInfo): void {
		domNode.setFontFamily(fontInfo.fontFamily);
		domNode.setFontWeight(fontInfo.fontWeight);
		domNode.setFontSize(fontInfo.fontSize);
		domNode.setLineHeight(fontInfo.lineHeight);
	}

	constructor(options: any, referenceDomElement: HTMLElement = null) {
		super(options, new ElementSizeObserver(referenceDomElement, () => this._onReferenceDomElementSizeChanged()));

		this._register(CSSBasedConfiguration.INSTANCE.onDidChange(() => () => this._onCSSBasedConfigurationChanged()));

		if (this._configWithDefaults.getEditorOptions().automaticLayout) {
			this._elementSizeObserver.startObserving();
		}

		this._register(browser.onDidChangeZoomLevel(_ => this._recomputeOptions()));
	}

	private _onReferenceDomElementSizeChanged(): void {
		this._recomputeOptions();
	}

	private _onCSSBasedConfigurationChanged(): void {
		this._recomputeOptions();
	}

	public observeReferenceElement(dimension?: IDimension): void {
		this._elementSizeObserver.observe(dimension);
	}

	public dispose(): void {
		this._elementSizeObserver.dispose();
		super.dispose();
	}

	protected _getEditorClassName(theme: string, fontLigatures: boolean): string {
		let extra = '';
		if (browser.isIE) {
			extra += 'ie ';
		} else if (browser.isFirefox) {
			extra += 'ff ';
		} else if (browser.isEdge) {
			extra += 'edge ';
		}
		if (platform.isMacintosh) {
			extra += 'mac ';
		}
		if (fontLigatures) {
			extra += 'enable-ligatures ';
		}
		return 'monaco-editor ' + extra + theme;
	}

	protected getOuterWidth(): number {
		return this._elementSizeObserver.getWidth();
	}

	protected getOuterHeight(): number {
		return this._elementSizeObserver.getHeight();
	}

	protected _getCanUseTranslate3d(): boolean {
		return browser.canUseTranslate3d && browser.getZoomLevel() === 0;
	}

	protected readConfiguration(bareFontInfo: BareFontInfo): FontInfo {
		return CSSBasedConfiguration.INSTANCE.readConfiguration(bareFontInfo);
	}
}
