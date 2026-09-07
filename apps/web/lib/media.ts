import {Media} from "./types";

const technicalMedia=/(blueprint|details?|infographic|schema|diagram|схем|инфограф)/i;

export function productCover(media:Media[]){
  const ordered=[...media].sort((a,b)=>a.sort_order-b.sort_order);
  const ordinary=ordered.filter(item=>!technicalMedia.test(`${item.url} ${item.alt_text||""}`));
  return ordinary.find(item=>item.is_primary)||ordinary[0]||ordered.find(item=>item.is_primary)||ordered[0];
}

export function productGallery(media:Media[]){
  const ordered=[...media].sort((a,b)=>a.sort_order-b.sort_order);
  const cover=productCover(ordered);
  return cover?[cover,...ordered.filter(item=>item.id!==cover.id)]:ordered;
}
