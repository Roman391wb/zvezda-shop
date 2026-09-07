import type {Metadata} from "next";
import {InformationPage} from "@/components/information-page";
export const metadata:Metadata={title:"О магазине"};
export default function AboutPage(){return <InformationPage eyebrow="О магазине" title="О магазине" intro="Пространство с вниманием к форме, ткани и спокойной выразительности повседневного гардероба." sections={[{title:"Наш подход",body:"Мы выбираем модели, в которых легко двигаться, быть собой и возвращаться к любимым вещам из сезона в сезон."},{title:"Выбор модели",body:"Консультант поможет уточнить посадку, размер и детали изделия перед оформлением заказа."},{title:"История",body:"Добавьте здесь реальную историю основателя, принципы отбора коллекций и подтверждённые факты о магазине."}]}/>}
