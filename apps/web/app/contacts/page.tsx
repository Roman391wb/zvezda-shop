import type {Metadata} from "next";
import {InformationPage} from "@/components/information-page";
import {getStoreSettings} from "@/lib/api";
export const metadata:Metadata={title:"Контакты"};
export default async function ContactsPage(){const settings=await getStoreSettings();return <InformationPage eyebrow="Связь с магазином" title="Контакты" intro={settings.store_name?`Связь с ${settings.store_name}.`:"Мы принимаем заказы и помогаем с выбором в WhatsApp."} sections={[{title:"Телефон",body:settings.phone||"Контактный телефон пока не указан."},{title:"WhatsApp",body:settings.whatsapp||"WhatsApp пока не указан."},{title:"Telegram",body:settings.telegram||"Telegram пока не указан."},{title:"Email",body:settings.email||"Email пока не указан."}]}/>}
