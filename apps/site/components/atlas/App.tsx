"use client";
import React from 'react';
import TicLayer from './TicLayer';
import MarketLanding from '@/components/home/MarketLanding';
import './styles.css';
/** The landing exposes independent market views without mixing their observations. */
export default function App(){
 return <main className="hosted-atlas"><MarketLanding/><div id="tic-view" style={{scrollMarginTop:16}}><TicLayer/></div></main>
}
