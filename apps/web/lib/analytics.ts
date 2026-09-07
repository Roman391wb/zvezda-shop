export type AnalyticsEvent="page_view"|"product_view"|"search"|"favorite_add"|"favorite_remove"|"add_to_cart"|"remove_from_cart"|"cart_view"|"whatsapp_checkout_click";
export const analytics={track:(event:AnalyticsEvent,payload:Record<string,unknown>={})=>{if(process.env.NODE_ENV!=="production")console.info(JSON.stringify({event,payload,at:new Date().toISOString()}))}};
