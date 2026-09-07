import type {Metadata} from "next";
import {FavoritesView} from "@/components/favorites-view";

export const metadata:Metadata={title:"Избранное"};
export default function FavoritesPage(){return <main className="wrap"><FavoritesView/></main>}
