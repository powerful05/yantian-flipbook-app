const PLACE_CONTEXTS = Object.freeze([
  Object.freeze({
    canonical_name: "大梅沙海滨公园",
    aliases: ["大梅沙", "大梅沙海滨公园", "大梅沙海滨浴场"],
    kind: "beach_park",
    administrative_area: "广东省深圳市盐田区梅沙街道",
    verified_facts: [
      "大梅沙海滨公园位于深圳市盐田区梅沙街道滨海地带。",
      "该地点属于海滨公共休闲空间，画面主体应以沙滩、海岸步道和近岸景观为主。",
    ],
    source_urls: ["https://www.yantian.gov.cn/"],
    visual_focus: "大梅沙沙滩、海岸线、滨海步道、公共服务设施与近岸山体，保持海滨公园的开放尺度。",
    excluded_visuals: ["盐田港", "集装箱码头", "岸桥", "货轮", "航道", "堆场", "桥吊", "港区道路"],
    coordinate_status: "not_verified_from_official_source",
  }),
  Object.freeze({
    canonical_name: "深圳市盐田区人民政府",
    aliases: ["盐田区人民政府", "深圳市盐田区人民政府", "盐田区政府"],
    kind: "government_institution",
    administrative_area: "广东省深圳市盐田区",
    verified_facts: [
      "盐田区政府门户网站的主办单位为深圳市盐田区人民政府办公室。",
      "该站点将主体标识为深圳市盐田区人民政府。",
    ],
    source_urls: ["https://www.yantian.gov.cn/"],
    visual_focus: "政务办公建筑群、入口广场、公共服务导视与周边城市街道，保持行政办公场所的克制尺度。",
    excluded_visuals: ["盐田港", "集装箱码头", "岸桥", "货轮", "航道", "堆场", "桥吊"],
    coordinate_status: "not_verified_from_official_source",
  }),
]);

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

export function resolvePlaceContext(query) {
  const target = normalize(query);
  if (!target) return null;
  const match = PLACE_CONTEXTS.find((context) => context.aliases.some((alias) => {
    const candidate = normalize(alias);
    return candidate && (candidate === target || target.includes(candidate));
  }));
  if (!match) return null;
  const { aliases, ...publicContext } = match;
  return structuredClone(publicContext);
}
