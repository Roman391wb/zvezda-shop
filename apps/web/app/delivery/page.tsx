import type {Metadata} from "next";
import {InformationPage} from "@/components/information-page";
import {getStoreSettings} from "@/lib/api";
export const metadata:Metadata={title:"Доставка"};
export default async function DeliveryPage(){const settings=await getStoreSettings();return <InformationPage eyebrow="Помощь" title="Доставка" intro={settings.delivery||"После оформления в WhatsApp консультант уточнит удобный способ получения и подтвердит детали."} sections={[{title:"Как оформить",body:"Добавьте модели в корзину и перейдите в WhatsApp: сообщение с составом и суммой сформируется автоматически."},{title:"Получение заказа",body:settings.delivery||"Способ получения, сроки и стоимость подтверждаются консультантом в WhatsApp."}]}/>}
