export interface PromptPreset {
  id:string; name:string; applicable:string; skeleton:string; negative:string;
  referenceAndParameters:string; example:string; scenario:string;
  variables:Record<string,string>;
}
export const antiPlastic='保留细微色差与合理表面起伏，不做整体磨皮或过度锐化；真人保留自然毛孔与轻微不对称，发丝不完全对称；光比真实，允许轻微不完美。三维主体只遵守其材质规范，不给塑料、玻璃或金属添加皮肤毛孔。';
export const promptPresets:PromptPreset[]=[
  {id:'real',name:'真人感海报',applicable:'人物海报、含真人的社媒与产品画面',scenario:'需要可信的摄影人物，而非塑料脸。',example:'real',
    skeleton:'{人物特征}人物肖像，脸型与五官自然，保留轻微真实不对称，不做对称修脸。发型：{发型}，自然蓬松、发丝有层次，不做僵硬油头。着装：{着装}。气质：{气质}。自然柔光，皮肤保留细微色差与纹理，人物与背景的光向一致。',
    negative:'塑料皮肤、整体磨皮、五官过度对称、僵硬油头、无要求的西装与饰品、棚拍硬光、AI锐化光晕、过度平滑发丝。',referenceAndParameters:'推荐已获授权的人像照片与真实肤质近景。建议3:4或2:3；相似度须出图后核对，不能靠文字保证。',variables:{人物特征:'约45岁、东亚男性，窄长椭圆脸、内双细长眼',发型:'干净短侧分黑发',着装:'浅灰色圆领上衣',气质:'冷静、克制、有判断力'}},
  {id:'meme',name:'网络梗图／社媒图',applicable:'社媒海报、日常感内容图',scenario:'故意保留生活抓拍的笨拙与真实。',example:'meme',
    skeleton:'{主体}，发生在{日常场景}。手机镜头随手拍摄，{瞬间}；构图略随意、轻微手持晃动，允许真实杂物、反光与路人，色彩略偏、少量自然噪点，无商业后期修饰。{文字要求}',negative:'高级感、棚拍、完美构图、商业修图、过度降噪、过强锐化、故意损毁主体和不可读文字。',referenceAndParameters:'推荐普通手机生活照，避免广告精修图。建议1:1或3:4；轻微噪点为风格，不把严重糊损当真实感。',variables:{主体:'一只橘猫',日常场景:'有纸箱的普通客厅',瞬间:'猫一脸认真地坐在空纸箱旁',文字要求:'不添加文字'}},
  {id:'three-d',name:'三维海报',applicable:'三维IP、产品主K及三维社媒画面',scenario:'用可解释的材质与灯光建立三维质感。',example:'three-d',
    skeleton:'{主体}。材质对比：{材质组合}，至少两种材质明确区分；若有指定IP，不改变IP本体材质，把对比放到道具与环境。{灯光}，光源可数，明确反射与折射来自哪里。{构图}，细节密度高但焦点清楚，接触阴影和透视统一。',negative:'无来源高光、乱反射、全材质塑料化、无关颗粒、噪纹、过度锐化、为对比改造指定IP。',referenceAndParameters:'推荐IP规范图、真实玻璃与拉丝金属材质样本。建议3:4或16:9；灯光1—2个，不虚构渲染器参数。',variables:{主体:'玻璃环形雕塑与小球',材质组合:'透明玻璃、拉丝银色金属、雾面蓝色塑料',灯光:'左侧与右上两处宽面柔光',构图:'单一主物，前后层次明确'}},
  {id:'product',name:'产品静物',applicable:'产品主K、资源位及静物社媒',scenario:'让真实产品材质、包装和轮廓先被看清。',example:'product',
    skeleton:'{产品}静物摄影。{材质}，保持商品形状、标签、数量与品牌素材准确。{布景}，只有解释商品的少量道具。{光线}，主光明确，反射、接触阴影真实，轮廓与文字可读。',negative:'错误包装、虚构功效、标签乱码、塑料化材质、不可信水花、强光遮主标、过锐边缘。',referenceAndParameters:'推荐真实产品正面、侧面与材质近景。建议4:3或3:4；无产品素材时只能做待替换示意，不能宣称复刻。',variables:{产品:'无标识白色陶瓷按压瓶',材质:'陶瓷细腻，旁置透明玻璃片作对比',布景:'石墨灰干净台面',光线:'单一侧面大柔光'}},
  {id:'title',name:'KV 大标题字',applicable:'各类海报与KV的标题字素材',scenario:'只生成指定标题字，不擅加海报场景。',example:'title',
    skeleton:'只生成标题“{标题}”。{字体方向}，{字形细节}，{版式}。只出现指定标题，字形完整、准确、可读，纯黑背景纯白字，作为可独立排版的标题素材。',negative:'多余文字、英文装饰、副标题、水印、场景、人物、错字、笔画粘连和透视损坏。',referenceAndParameters:'标题字技能单张适配入口；默认16:9黑底白字，不承诺原生2K。需要整类批量时另行调用标题字技能确认类别与张数。',variables:{标题:'向前',字体方向:'现代活力黑体',字形细节:'粗壮笔画，清晰字腔与克制斜切',版式:'紧凑居中，四周留安全边距'}}
];
export function fillSkeleton(template:string,values:Record<string,string>){
  // A cleared field is an intentional omission, never a request to restore a default.
  return template.split(/(?<=[。；\n])/).map(clause=>{
    if(/^(发型|着装|气质)：\{([^{}]+)\}/.test(clause)&&!values[clause.match(/\{([^{}]+)\}/)![1]]?.trim())return '';
    return clause.replace(/\{([^{}]+)\}/g,(_,key)=>values[key]?.trim()||'');
  }).join('').trim();
}
export function composePreset(preset:PromptPreset,skeleton:string,negative:string,values:Record<string,string>,base:string,useAntiPlastic:boolean){
  return [base.trim()&&`【当前画面需求】\n${base.trim()}`,`【质感层：${preset.name}】\n${fillSkeleton(skeleton,values)}`,useAntiPlastic?antiPlastic:'',`避免：${negative.trim()}`,'质感预设只约束表现，不覆盖已确认的身份、IP规范、包装、文案和构图；示例变量与当前需求冲突时以当前需求为准。'].filter(Boolean).join('\n\n');
}
