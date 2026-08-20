-- Bloxy Studio Plugin
-- Replace WEBSITE_URL after deployment, then save this script as a local plugin.

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local InsertService = game:GetService("InsertService")

local WEBSITE_URL = "https://bloxy.radin-yt1324.workers.dev"
local toolbar = plugin:CreateToolbar("Bloxy")
local openButton = toolbar:CreateButton("Bloxy", "Pair Studio with the Bloxy website", "")
local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 390, 560, 320, 430)
local widget = plugin:CreateDockWidgetPluginGui("BloxyBuilder", widgetInfo)
widget.Title = "Bloxy · AI Builder"

local colors = { bg=Color3.fromRGB(8,11,13), panel=Color3.fromRGB(16,21,24), line=Color3.fromRGB(41,50,56), text=Color3.fromRGB(237,242,241), muted=Color3.fromRGB(130,144,151), yellow=Color3.fromRGB(242,201,76), cyan=Color3.fromRGB(110,231,224), red=Color3.fromRGB(228,111,69) }
local function new(class, props, parent)
	local item=Instance.new(class)
	for key,value in pairs(props or {}) do item[key]=value end
	item.Parent=parent
	return item
end

local root=new("Frame",{Size=UDim2.fromScale(1,1),BackgroundColor3=colors.bg,BorderSizePixel=0},widget)
new("UIPadding",{PaddingTop=UDim.new(0,18),PaddingBottom=UDim.new(0,18),PaddingLeft=UDim.new(0,18),PaddingRight=UDim.new(0,18)},root)
local stack=new("UIListLayout",{Padding=UDim.new(0,12),SortOrder=Enum.SortOrder.LayoutOrder},root)
local title=new("TextLabel",{LayoutOrder=1,Size=UDim2.new(1,0,0,34),BackgroundTransparency=1,Text="BLOXY",TextColor3=colors.text,Font=Enum.Font.GothamBlack,TextSize=22,TextXAlignment=Enum.TextXAlignment.Left},root)
local status=new("TextLabel",{LayoutOrder=2,Size=UDim2.new(1,0,0,25),BackgroundColor3=colors.panel,BorderColor3=colors.line,Text="  ●  WAITING FOR PAIRING CODE",TextColor3=colors.red,Font=Enum.Font.Code,TextSize=11,TextXAlignment=Enum.TextXAlignment.Left},root)
local codeBox=new("TextBox",{LayoutOrder=3,Size=UDim2.new(1,0,0,48),BackgroundColor3=colors.panel,BorderColor3=colors.line,PlaceholderText="ABCD-1234",Text="",TextColor3=colors.text,PlaceholderColor3=colors.muted,Font=Enum.Font.Code,TextSize=22,ClearTextOnFocus=false},root)
local pairButton=new("TextButton",{LayoutOrder=4,Size=UDim2.new(1,0,0,42),BackgroundColor3=colors.yellow,BorderSizePixel=0,Text="PAIR WEBSITE",TextColor3=colors.bg,Font=Enum.Font.GothamBold,TextSize=13},root)
local heading=new("TextLabel",{LayoutOrder=5,Size=UDim2.new(1,0,0,26),BackgroundTransparency=1,Text="BUILD BLUEPRINT",TextColor3=colors.cyan,Font=Enum.Font.Code,TextSize=11,TextXAlignment=Enum.TextXAlignment.Left},root)
local preview=new("TextLabel",{LayoutOrder=6,Size=UDim2.new(1,0,1,-280),BackgroundColor3=colors.panel,BorderColor3=colors.line,Text="No blueprint yet.\n\nPair this plugin, then describe a build on the website.",TextWrapped=true,TextColor3=colors.muted,Font=Enum.Font.Code,TextSize=12,TextXAlignment=Enum.TextXAlignment.Left,TextYAlignment=Enum.TextYAlignment.Top},root)
new("UIPadding",{PaddingTop=UDim.new(0,13),PaddingLeft=UDim.new(0,13),PaddingRight=UDim.new(0,13)},preview)
local applyButton=new("TextButton",{LayoutOrder=7,Size=UDim2.new(1,0,0,44),BackgroundColor3=colors.line,BorderSizePixel=0,Text="WAITING FOR BLUEPRINT",TextColor3=colors.muted,Font=Enum.Font.GothamBold,TextSize=13,AutoButtonColor=false,Active=false},root)

local pluginToken = plugin:GetSetting("BloxyPluginToken")
local currentJob = nil
local polling = false
local allowedClasses = {Folder=true,Model=true,Part=true,WedgePart=true,SpawnLocation=true,ScreenGui=true,Frame=true,ScrollingFrame=true,ImageLabel=true,ImageButton=true,TextLabel=true,TextButton=true,TextBox=true,UIListLayout=true,UIGridLayout=true,UIPadding=true,UICorner=true,UIStroke=true,UIGradient=true,UIAspectRatioConstraint=true}
local allowedRoots = {Workspace=workspace,ReplicatedStorage=game:GetService("ReplicatedStorage"),ServerScriptService=game:GetService("ServerScriptService"),StarterGui=game:GetService("StarterGui"),StarterPlayer=game:GetService("StarterPlayer")}

local function request(path, method, body, auth)
	local headers={ ["Content-Type"]="application/json" }
	if auth then headers.Authorization="Bearer "..auth end
	local response=HttpService:RequestAsync({Url=WEBSITE_URL..path,Method=method or "GET",Headers=headers,Body=body and HttpService:JSONEncode(body) or nil})
	if not response.Success then error("Bloxy request failed: "..response.StatusCode) end
	return HttpService:JSONDecode(response.Body)
end

local function resolveParent(path)
	local pieces=string.split(path or "Workspace",".")
	local current=allowedRoots[table.remove(pieces,1)]
	if not current then return nil end
	for _,name in ipairs(pieces) do current=current:FindFirstChild(name); if not current then return nil end end
	return current
end

local function safeSource(source)
	local blocked={"loadstring","HttpGet","GetObjects","require%s*%(%s*%d","getfenv","setfenv","debug%."}
	for _,pattern in ipairs(blocked) do if string.find(source,pattern) then return false end end
	return #source <= 30000
end

local function colorFromHex(value)
	if typeof(value)~="string" then return value end
	local hex=string.gsub(value,"#","")
	if #hex~=6 then return value end
	return Color3.fromRGB(tonumber(string.sub(hex,1,2),16) or 255,tonumber(string.sub(hex,3,4),16) or 255,tonumber(string.sub(hex,5,6),16) or 255)
end

local function applyProperty(object,property,value)
	if property=="SearchQuery" or property=="Scale" then return end
	if object:IsA("BasePart") then
		if (property=="Position" or property=="Size") and typeof(value)=="table" then object[property]=Vector3.new(tonumber(value[1]) or 0,tonumber(value[2]) or 0,tonumber(value[3]) or 0); return end
		if property=="Rotation" and typeof(value)=="table" then object.Orientation=Vector3.new(tonumber(value[1]) or 0,tonumber(value[2]) or 0,tonumber(value[3]) or 0); return end
		if property=="Color" then object.Color=colorFromHex(value); return end
		if property=="Material" and typeof(value)=="string" and Enum.Material[value] then object.Material=Enum.Material[value]; return end
		if property=="Shape" then
			if object:IsA("Part") and value~="Wedge" and Enum.PartType[value] then object.Shape=Enum.PartType[value] end
			return
		end
	end
	if object:IsA("GuiObject") then
		if (property=="Position" or property=="Size") and typeof(value)=="table" then object[property]=UDim2.new(tonumber(value[1]) or 0,tonumber(value[2]) or 0,tonumber(value[3]) or 0,tonumber(value[4]) or 0); return end
		if property=="AnchorPoint" and typeof(value)=="table" then object.AnchorPoint=Vector2.new(tonumber(value[1]) or 0,tonumber(value[2]) or 0); return end
	end
	if (property=="BackgroundColor3" or property=="TextColor3" or property=="ImageColor3" or property=="Color") and typeof(value)=="string" then object[property]=colorFromHex(value); return end
	if property=="Font" and typeof(value)=="string" and Enum.Font[value] then object.Font=Enum.Font[value]; return end
	if property=="TextXAlignment" and typeof(value)=="string" and Enum.TextXAlignment[value] then object.TextXAlignment=Enum.TextXAlignment[value]; return end
	if property=="TextYAlignment" and typeof(value)=="string" and Enum.TextYAlignment[value] then object.TextYAlignment=Enum.TextYAlignment[value]; return end
	if property=="FillDirection" and typeof(value)=="string" and Enum.FillDirection[value] then object.FillDirection=Enum.FillDirection[value]; return end
	if property=="HorizontalAlignment" and typeof(value)=="string" and Enum.HorizontalAlignment[value] then object.HorizontalAlignment=Enum.HorizontalAlignment[value]; return end
	if property=="VerticalAlignment" and typeof(value)=="string" and Enum.VerticalAlignment[value] then object.VerticalAlignment=Enum.VerticalAlignment[value]; return end
	if property=="SortOrder" and typeof(value)=="string" and Enum.SortOrder[value] then object.SortOrder=Enum.SortOrder[value]; return end
	if (property=="CornerRadius" or property=="Padding" or string.find(property,"Padding")) and typeof(value)=="table" then object[property]=UDim.new(tonumber(value[1]) or 0,tonumber(value[2]) or 0); return end
	object[property]=value
end

local function renderJob(job)
	currentJob=job
	local lines={"PROMPT\n"..job.prompt,"\nPROPOSED ACTIONS"}
	for index,action in ipairs(job.actions) do table.insert(lines,string.format("\n%02d  [%s]  %s\n     %s",index,string.upper(action.type),action.name,action.summary or "")) end
	preview.Text=table.concat(lines,"\n")
	applyButton.Text="APPLY "..#job.actions.." ACTIONS"
	applyButton.BackgroundColor3=colors.cyan; applyButton.TextColor3=colors.bg; applyButton.Active=true; applyButton.AutoButtonColor=true
end

local function applyJob()
	if not currentJob then return end
	ChangeHistoryService:SetWaypoint("Before Bloxy build")
	for _,action in ipairs(currentJob.actions) do
		local parent=resolveParent(action.parent)
		if not parent then error("Parent not found: "..tostring(action.parent)) end
		if action.type=="create_instance" then
			if not allowedClasses[action.className] then error("Blocked class: "..tostring(action.className)) end
			local className=action.className
			if className=="Part" and action.properties and action.properties.Shape=="Wedge" then className="WedgePart" end
			local object=Instance.new(className); object.Name=action.name
			for property,value in pairs(action.properties or {}) do pcall(function() applyProperty(object,property,value) end) end
			object.Parent=parent
		elseif action.type=="create_script" then
			if not safeSource(action.source or "") then error("Generated script failed safety checks") end
			local isClient=parent:IsDescendantOf(game:GetService("StarterPlayer")) or parent:IsDescendantOf(game:GetService("StarterGui"))
			local className=isClient and "LocalScript" or "Script"
			local scriptObject=Instance.new(className); scriptObject.Name=action.name; scriptObject.Source=action.source; scriptObject.Parent=parent
		elseif action.type=="import_asset" then
			local assetId=tonumber(action.assetId)
			if not assetId or assetId<1 then error("Invalid Roblox asset ID") end
			local container=InsertService:LoadAsset(assetId)
			for _,descendant in ipairs(container:GetDescendants()) do
				if descendant:IsA("LuaSourceContainer") then descendant:Destroy() end
			end
			container.Name=action.name or ("CreatorAsset_"..assetId)
			container.Parent=parent
			local properties=action.properties or {}
			local scale=math.clamp(tonumber(properties.Scale) or 1,0.25,4)
			pcall(function() container:ScaleTo(scale) end)
			local position=properties.Position or {0,1,0}
			local rotation=properties.Rotation or {0,0,0}
			local px,py,pz=tonumber(position[1]) or 0,tonumber(position[2]) or 1,tonumber(position[3]) or 0
			local rx,ry,rz=math.rad(tonumber(rotation[1]) or 0),math.rad(tonumber(rotation[2]) or 0),math.rad(tonumber(rotation[3]) or 0)
			pcall(function() container:PivotTo(CFrame.new(px,py,pz)*CFrame.Angles(rx,ry,rz)) end)
		end
	end
	ChangeHistoryService:SetWaypoint("Bloxy build applied")
	request("/api/plugin/complete","POST",{jobId=currentJob.id,status="applied"},pluginToken)
	preview.Text="Build applied. Use Studio Undo to revert it."; currentJob=nil; applyButton.Active=false; applyButton.AutoButtonColor=false; applyButton.Text="WAITING FOR BLUEPRINT"; applyButton.BackgroundColor3=colors.line
end

local function poll()
	if polling or not pluginToken then return end
	polling=true
	task.spawn(function()
		while pluginToken do
			local ok,result=pcall(request,"/api/plugin/poll","GET",nil,pluginToken)
			if ok and result.job and not currentJob then renderJob(result.job) end
			task.wait(2)
		end
		polling=false
	end)
end

pairButton.MouseButton1Click:Connect(function()
	local ok,result=pcall(request,"/api/plugin/pair","POST",{code=codeBox.Text})
	if ok then pluginToken=result.pluginToken;plugin:SetSetting("BloxyPluginToken",pluginToken);status.Text="  ●  WEBSITE CONNECTED";status.TextColor3=colors.cyan;codeBox.Visible=false;pairButton.Visible=false;poll() else status.Text="  ●  PAIRING FAILED";status.TextColor3=colors.red end
end)
applyButton.MouseButton1Click:Connect(function() local ok,err=pcall(applyJob);if not ok then preview.Text="Build stopped safely:\n"..tostring(err) end end)
openButton.Click:Connect(function() widget.Enabled=not widget.Enabled end)
if pluginToken then status.Text="  ●  RECONNECTING";status.TextColor3=colors.yellow;poll() end
