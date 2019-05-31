import * as path from 'path';
import * as vscode from 'vscode';
import * as child from 'child_process';
var fs = require("fs");
var xml2js = require('xml2js');

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('sfdxPackageGen.chooseMetadata', () => {
			CodingPanel.createOrShow(context.extensionPath);
		})
	);


}

/**
 * Manages cat coding webview panels
 */
class CodingPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: CodingPanel | undefined;

	public static readonly viewType = 'Coding';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private _disposables: vscode.Disposable[] = [];
	private reportFolderMap={
		Dashboard : 'DashboardFolder',
		Document :'DocumentFolder',
		EmailTemplate :'EmailFolder',
		Report :'ReportFolder'
	};

	//metadata types that accept * reg exp
	private regExpArr=['AccountRelationshipShareRule','ActionLinkGroupTemplate','ApexClass','ApexComponent',
'ApexPage','ApexTrigger','AppMenu','ApprovalProcess','ArticleType','AssignmentRules','Audience','AuthProvider',
'AuraDefinitionBundle','AutoResponseRules','Bot','BrandingSet','CallCenter','Certificate','CleanDataService',
'CMSConnectSource','Community','CommunityTemplateDefinition','CommunityThemeDefinition','CompactLayout',
'ConnectedApp','ContentAsset','CorsWhitelistOrigin','CustomApplication','CustomApplicationComponent',
'CustomFeedFilter','CustomHelpMenuSection','CustomMetadata','CustomLabels','CustomObjectTranslation',
'CustomPageWebLink','CustomPermission','CustomSite','CustomTab','DataCategoryGroup','DelegateGroup',
'DuplicateRule','EclairGeoData','EntitlementProcess','EntitlementTemplate','EventDelivery','EventSubscription',
'ExternalServiceRegistration','ExternalDataSource','FeatureParameterBoolean','FeatureParameterDate','FeatureParameterInteger',
'FieldSet','FlexiPage','Flow','FlowCategory','FlowDefinition','GlobalValueSet','GlobalValueSetTranslation','Group','HomePageComponent',
'HomePageLayout','InstalledPackage','KeywordList','Layout','LightningBolt','LightningComponentBundle','LightningExperienceTheme',
'LiveChatAgentConfig','LiveChatButton','LiveChatDeployment','LiveChatSensitiveDataRule','ManagedTopics','MatchingRules','MilestoneType',
'MlDomain','ModerationRule','NamedCredential','Network','NetworkBranding','PathAssistant','PermissionSet','PlatformCachePartition',
'Portal','PostTemplate','PresenceDeclineReason','PresenceUserConfig','Profile','ProfilePasswordPolicy','ProfileSessionSetting',
'Queue','QueueRoutingConfig','QuickAction','RecommendationStrategy','RecordActionDeployment','ReportType','Role','SamlSsoConfig',
'Scontrol','ServiceChannel','ServicePresenceStatus','SharingRules','SharingSet','SiteDotCom','Skill','StandardValueSetTranslation',
'StaticResource','SynonymDictionary','Territory','Territory2','Territory2Model','Territory2Rule','Territory2Type','TopicsForObjects',
'TransactionSecurityPolicy','Translations','WaveApplication','WaveDashboard','WaveDataflow','WaveDataset','WaveLens','WaveTemplateBundle',
'WaveXmd','Workflow'];

	private  PACKAGE_START='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+
														'<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n';

	private  TYPES_START='<types>';	
	private  TYPES_END='</types>';			
	private  MEMBERS_START='<members>';	
	private  MEMBERS_END='</members>';
	private  NAME_START='<name>';	
	private  NAME_END='</name>';
	private  VERSION_START='<version>';	
	private  VERSION_END='</version>';
	private  PACKAGE_END='</Package>';
	private NEW_LINE ='\n';
	private VERSION_NUM='45.0';
	private CHAR_TAB='\t';
	private LOADING='*loading..';

	public static createOrShow(extensionPath: string) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (CodingPanel.currentPanel) {
			CodingPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			CodingPanel.viewType,
			'Choose Metadata Components',
			column || vscode.ViewColumn.One,
			{
				// Enable javascript in the webview
				enableScripts: true,
				retainContextWhenHidden: true,
				// And restrict the webview to only loading content from our extension's `media` directory.
				localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
			}
		);

		CodingPanel.currentPanel = new CodingPanel(panel, extensionPath);

	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string) {
		CodingPanel.currentPanel = new CodingPanel(panel, extensionPath);
	}

	private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
		this._panel = panel;
		this._extensionPath = extensionPath;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		/*this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);*/

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'fetchChildren':
						console.log('onDidReceiveMessage fetchChildren');
						let metadataType = message.metadataType;
						this.fetchChildren(metadataType);
						return;

					case 'buildPackageXML':
						console.log('onDidReceiveMessage buildPackageXML');
						this.buildPackageXML(message.selectedNodes);
						return;

					case 'getMetadataTypes':
						console.log('onDidReceiveMessage getMetadataTypes');
						this.getMetadataTypes({});
						return;
				}
			},
			null,
			this._disposables
		);
	}

	private buildPackageXML(selectedNodes){
		console.log('Invoked buildPackageXML');
		if(!selectedNodes || selectedNodes.length==0){
			vscode.window.showErrorMessage("Please select components for package.xml");
			return;
		}

		let mpPackage=this.buildPackageMap(selectedNodes);
		this.generatePackageXML(mpPackage);

	}

	private buildPackageMap(selectedNodes){
		console.log('Invoked buildPackageMap');
		let mpPackage=new Map();

		for(let i=0;i<selectedNodes.length;i++){
		
			
			let node=selectedNodes[i];
			let parent=node.parent;

			//do not add loading child node to final map
			if(node.text==this.LOADING){
				continue;
			}
		

			if(parent=='#'){
				//parent node
			
				if(!mpPackage.has(node.text)){
				
					//new entry
					if(this.regExpArr.includes(node.text)){
					
						//accepts *
						mpPackage.set(node.text,['*']);
					
					}else{
					
						mpPackage.set(node.text,[]);
						
					}
				}else{
					if(this.regExpArr.includes(node.text)){
						
						//accepts *
						mpPackage.set(node.text,['*']);
					
					}
				}
			}else{
				//children
			
				if(!mpPackage.has(parent)){
				
					//metadata type not present
					mpPackage.set(parent,[node.text]);
					
				}else{
				
					let childArr=mpPackage.get(parent);
					if(!childArr.includes('*')){
					
						//add children only if parent metadata type does not accept *
						childArr.push(node.text);
						mpPackage.set(parent,childArr);
					

					}
				
				}
			
			}//else children end


		}//end for

		for (const [k, v] of mpPackage) {
			console.log(k, v);
		}
		return mpPackage;

	}

	private generatePackageXML(mpPackage){
		console.log('Invoked generatePackageXML');
		//for parent metadata types which have empty children, fetch the children and rebuild the map entries.
		if(!mpPackage || mpPackage.size ==0){
			console.log('Invoked generatePackageXML'+mpPackage);
			return mpPackage;
		}
		

		let xmlString='';
		xmlString+=this.PACKAGE_START;

		for (const [mType, components] of mpPackage) {
			//remove metadata types with empty array values
			if(!components || components.length==0){
				continue;
			}

			xmlString+=this.CHAR_TAB+this.TYPES_START+this.NEW_LINE;
			let componentsSorted = components.sort();
			
			for(const component of componentsSorted){
				xmlString+=this.CHAR_TAB+this.CHAR_TAB+this.MEMBERS_START+component+this.MEMBERS_END+this.NEW_LINE;
			}

			xmlString+=this.CHAR_TAB+this.CHAR_TAB+this.NAME_START+mType+this.NAME_END+this.NEW_LINE;
			xmlString+=this.CHAR_TAB+this.TYPES_END+this.NEW_LINE;
		}

		xmlString+=this.CHAR_TAB+this.VERSION_START+this.VERSION_NUM+this.VERSION_END+this.NEW_LINE;
		xmlString+=this.PACKAGE_END;
		console.log(xmlString);

		fs.writeFile(vscode.workspace.workspaceFolders[0].uri.fsPath+"/manifest/package.xml", xmlString, (err) => {
			if (err) {
				console.log(err);
				vscode.window.showErrorMessage(err);
			}
			console.log("Successfully Written to File.");
			vscode.workspace.openTextDocument(vscode.workspace.workspaceFolders[0].uri.fsPath+"/manifest/package.xml").then(data =>{
				console.log('Opened '+ data.fileName);
				vscode.window.showTextDocument(data);
			});
		});

	}

	private fetchChildren(metadataType){
		console.log('Invoked fetchChildren');
		let mType=metadataType.id;
		let node = metadataType.original;
		console.log('Invoked fetchChildren '+JSON.stringify(node) );

		if(!node.inFolder){

			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Processing Metadata : "+mType,
				cancellable: true
			}, (progress, token) => {
				
				token.onCancellationRequested(() => {
					console.log("User canceled the long running operation");
				});
	
				
	
				var p = new Promise(resolve => {
					let sfdxCmd ="sfdx force:mdapi:listmetadata --json -m "+mType;
					let foo: child.ChildProcess = child.exec(sfdxCmd,{
					cwd: vscode.workspace.workspaceFolders[0].uri.fsPath
					});

					let bufferOutData='';

				foo.stdout.on("data",(dataArg : any)=> {
					console.log('stdout: ' + dataArg);
					bufferOutData+=dataArg;
					
					/*let data = JSON.parse(dataArg);
					let depArr=[];
					let results = data.result;
					this._panel.webview.postMessage({ command: 'listmetadata', results : results , metadataType : mType});
					resolve();*/
				});
		
				foo.stderr.on("data",(data : any)=> {
					console.log('stderr: ' + data);
					vscode.window.showErrorMessage(data);
					resolve();
				});
		
				foo.stdin.on("data",(data : any)=> {
					console.log('stdin: ' + data);
					//vscode.window.showErrorMessage(data);
					resolve();
				});
				
				foo.on('exit',(code,signal)=>{
					console.log('exit code '+code);
					console.log('bufferOutData '+bufferOutData);
					
					let data = JSON.parse(bufferOutData);
					let depArr=[];
					let results = data.result;
					this._panel.webview.postMessage({ command: 'listmetadata', results : results , metadataType : mType});
					resolve();
				});
					
				});
	
				return p;
				
			});

			




		}else{
				//get the folder

		let folderType = this.reportFolderMap[mType];
		let sfdxCmd ="sfdx force:mdapi:listmetadata --json -m "+folderType;

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Processing Metadata : "+folderType,
			cancellable: true
		}, (progress, token) => {
			token.onCancellationRequested(() => {
				console.log("User canceled the long running operation")
			});

			

			var p = new Promise(resolve => {
				let foo: child.ChildProcess = child.exec(sfdxCmd,{
					cwd: vscode.workspace.workspaceFolders[0].uri.fsPath
					});
				
				let bufferOutData='';

				foo.stdout.on("data",(dataArg : any)=> {
					console.log('stdout: ' + dataArg);
					bufferOutData+=dataArg;

					/*let data = JSON.parse(dataArg);
					let folderNames=[];
					let results = data.result;
					
					if(!results || results.length==0){
						//no folders
						this._panel.webview.postMessage({ command: 'listmetadata', results : results , metadataType : mType});
						return;
					}else if(!Array.isArray(results)){
						//1 folder
						folderNames.push(results.fullName);
					}else{
						//many folders
						for(let i=0;i<results.length;i++){
							folderNames.push(results[i].fullName);
						}
					}
		
				//get the components inside each folder
				this.getComponentsInsideFolders(folderNames,mType,0,[]);
				resolve();*/
		
				});
		
				foo.stderr.on("data",(data : any)=> {
					console.log('stderr: ' + data);
					vscode.window.showErrorMessage(data);
					resolve();
				});
		
				foo.stdin.on("data",(data : any)=> {
					console.log('stdin: ' + data);
					resolve();
				});
				
				foo.on('exit',(code,signal)=>{
					console.log('exit code '+code);
					console.log('bufferOutData '+bufferOutData);
					
					let data = JSON.parse(bufferOutData);
					let folderNames=[];
					let results = data.result;
					
					if(!results || results.length==0){
						//no folders
						this._panel.webview.postMessage({ command: 'listmetadata', results : results , metadataType : mType});
						return;
					}else if(!Array.isArray(results)){
						//1 folder
						folderNames.push(results.fullName);
					}else{
						//many folders
						for(let i=0;i<results.length;i++){
							folderNames.push(results[i].fullName);
						}
					}
		
				//get the components inside each folder
				this.getComponentsInsideFolders(folderNames,mType,0,[]);
				resolve();

				});
				
			});

			return p;
			
		});

		}

	} 

	public getComponentsInsideFolders(folderNames,mType,index,resultsArr){
		 		if(index==folderNames.length){
					this._panel.webview.postMessage({ command: 'listmetadata', results : resultsArr , metadataType : mType});
					return;
				}


				vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "Processing Metadata : "+mType+":"+folderNames[index],
					cancellable: true
				}, (progress, token) => {
					token.onCancellationRequested(() => {
						console.log("User canceled the long running operation")
					});
		
					
		
					var p = new Promise(resolve => {
						let sfdxCmd ="sfdx force:mdapi:listmetadata --json -m "+mType+" --folder "+folderNames[index];
						let foo: child.ChildProcess = child.exec(sfdxCmd,{
							cwd: vscode.workspace.workspaceFolders[0].uri.fsPath
							});

						let bufferOutData='';

						foo.stdout.on("data",(dataArg : any)=> {
							console.log('stdout: ' + dataArg);
							bufferOutData+=dataArg;

							/*let data = JSON.parse(dataArg);
							let depArr=[];
							let results = data.result;
			
							if(results){
								if(!Array.isArray(results)){
									//1 folder
									resultsArr.push(results);
								}else{
									//many folders
									for(let i=0;i<results.length;i++){
										resultsArr.push(results[i]);
									}
								}
						}
							
							resolve();
							console.log('After resolve getComponentsInsideFolders');
							this.getComponentsInsideFolders(folderNames,mType,++index,resultsArr);*/
						
			
						});
				
						foo.stderr.on("data",(data : any)=> {
							console.log('stderr: ' + data);
							vscode.window.showErrorMessage(data);
							resolve();
						});
				
						foo.stdin.on("data",(data : any)=> {
							console.log('stdin: ' + data);
							resolve();
						});
						
						foo.on('exit',(code,signal)=>{
							console.log('exit code '+code);
							console.log('bufferOutData '+bufferOutData);

							let data = JSON.parse(bufferOutData);
							let depArr=[];
							let results = data.result;
			
							if(results){
								if(!Array.isArray(results)){
									//1 folder
									resultsArr.push(results);
								}else{
									//many folders
									for(let i=0;i<results.length;i++){
										resultsArr.push(results[i]);
									}
								}
						}
							
							resolve();
							console.log('After resolve getComponentsInsideFolders');
							this.getComponentsInsideFolders(folderNames,mType,++index,resultsArr);


						});
						
					});
		
					return p;
					
				});

		
	}


	public dispose() {
		CodingPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _update() {

		this._panel.title = 'Choose Metadata Components';
		this._panel.webview.html = this._getHtmlForWebview();

		this.readExistingPackageXML().then(mpExistingPackageXML=>{
			this.getMetadataTypes(mpExistingPackageXML);
		}).catch(err=>{
			console.log(err);
		});
	

	}

	

private readExistingPackageXML(){
	console.log('Read existing packge.xml');
	let mpExistingPackageXML={};
	let parser = new xml2js.Parser();
	
	return new Promise((resolve,reject)=>{
		fs.readFile(vscode.workspace.workspaceFolders[0].uri.fsPath+"/manifest/package.xml", function(err, data) {
			if(err){
				console.error(err);
				resolve(mpExistingPackageXML);
			}
				parser.parseString(data, function (err, result) {
					if(err){
						console.error(err);
						resolve(mpExistingPackageXML);
						//return;
					}
					console.log('Existing package.xml');	
					console.log(JSON.stringify(result));
					///mpExistingPackageXML=this.putExistingPackageXMLInMap(result);
					if(!result || !result.Package || !result.Package.types){
						resolve(mpExistingPackageXML);
					}
				
					let types=result.Package.types;
					for(let i=0;i<types.length;i++){
						let type=types[i];
				
						let name=type.name[0];
						let members=type.members;

						//for setting undetermined state
						if(members && !members.includes("*")){
							members.push("*loading..");
						}
						mpExistingPackageXML[name]=members;
				
					}
					
						console.log(mpExistingPackageXML);
				
					resolve(mpExistingPackageXML);
				});
		});

	});

		


}	

private getMetadataTypes(mpExistingPackageXML){
	console.log("getMetadataTypes invoked");
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Processing Metadata",
		cancellable: true
	}, (progress, token) => {
		token.onCancellationRequested(() => {
			console.log("User canceled the long running operation")
		});

		console.log("vscode.workspace.workspaceFolders[0].uri.fsPath "+vscode.workspace.workspaceFolders[0].uri.fsPath);

		var p = new Promise(resolve => {
			var foo: child.ChildProcess = child.exec('sfdx force:mdapi:describemetadata --json',{
				cwd: vscode.workspace.workspaceFolders[0].uri.fsPath
				});
			let bufferOutData='';
			foo.stdout.on("data",(dataArg : any)=> {
				
				console.log('dataArg '+dataArg);
				bufferOutData+=dataArg;
				/*let data = JSON.parse(dataArg);
				let depArr=[];
				let metadataObjectsArr = data.result.metadataObjects;
	
				for(let index=0;index<metadataObjectsArr.length;index++){
					let obj=metadataObjectsArr[index];
					console.log(obj.xmlName);
					depArr.push(obj.xmlName);
				}
				this._panel.webview.postMessage({ command: 'metadataObjects', metadataObjects: metadataObjectsArr});
				resolve();*/
			});
	
			foo.stderr.on("data",(data : any)=> {
				console.log('stderr: ' + data);
				vscode.window.showErrorMessage(data);
				resolve();
			});
	
			foo.stdin.on("data",(data : any)=> {
				console.log('stdin: ' + data);
				resolve();
			});

			foo.on("exit", (code: number, signal: string) => {
				console.log("exited with code "+code);
				console.log("bufferOutData "+bufferOutData);
				resolve();
				let data = JSON.parse(bufferOutData);
				let depArr=[];
				let metadataObjectsArr = data.result.metadataObjects;
	
				for(let index=0;index<metadataObjectsArr.length;index++){
					let obj=metadataObjectsArr[index];
					console.log(obj.xmlName);
					depArr.push(obj.xmlName);
				}
				this._panel.webview.postMessage({ command: 'metadataObjects', metadataObjects: metadataObjectsArr,
																					'mpExistingPackageXML' :mpExistingPackageXML});
			
			});
			console.log(typeof foo.on); 
				
			
		});

		return p;
		
	});
}
	private _getHtmlForWebview() {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.file(
			path.join(this._extensionPath, 'media', 'main.js')
		);

		// And the uri we use to load this script in the webview
		const scriptUri = scriptPathOnDisk.with({ scheme: 'vscode-resource' });


		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">

                <!--
                Use a content security policy to only allow loading images from https or from our extension directory,
                and only allow scripts that have a specific nonce.
                -->
                <!--<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src 'nonce-${nonce}';">-->
				<meta
				http-equiv="Content-Security-Policy"
				content="default-src 'none'; img-src vscode-resource: https:; script-src vscode-resource: https:; style-src vscode-resource: https:;"
			  />
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jstree/3.2.1/themes/default/style.min.css" />
				
                <title>Add Components</title>
            </head>
						<body>
						
						<table border="0" width="100%">
						<tr>
						<td><h3>Choose Metadata Components for Package.xml</h3></td>
						<td>
						<button id="buildBtn">Update Package.xml</button>&nbsp;
						<button id="clearAllBtn">Clear All</button>
						</td>
						</tr>
						</table>
						<hr>
				<div id="jstree">
				
			  </div>
			  
			
			  <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.1/jquery.min.js"></script>
			  <script src="https://cdnjs.cloudflare.com/ajax/libs/jstree/3.2.1/jstree.min.js"></script>
			  <script  src="${scriptUri}"></script>
            </body>
            </html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
