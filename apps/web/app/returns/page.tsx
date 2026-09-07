import type {Metadata} from "next";
import {InformationPage} from "@/components/information-page";
import {getStoreSettings} from "@/lib/api";
export const metadata:Metadata={title:"Возврат и обмен"};
export default async function ReturnsPage(){const settings=await getStoreSettings();return <InformationPage eyebrow="Помощь" title="Возврат и обмен" intro={settings.returns||"Если размер или модель не подошли, напишите консультанту в WhatsApp до отправки вещи обратно."} sections={[{title:"Условия",body:settings.returns||"Сохраните товарный вид изделия, ярлыки и комплектность до согласования обращения."},{title:"Обмен",body:"Наличие нужного размера или модели подтверждается индивидуально после связи с консультантом."}]}/>}
