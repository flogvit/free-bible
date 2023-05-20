import React, {useState} from 'react';
import Dashboard from "./Dashboard.jsx";
import theme from "./theme";
import themeDark from "./themeDark";
import styled, {createGlobalStyle, ThemeProvider} from "styled-components";
import {useDarkMode} from "usehooks-ts";

const AppContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: start;
  min-height: 100vh;
  padding: 20px;
  box-sizing: border-box;
  background-color: #1A1A1A;
  color: #F3F3F3;
`;

const GlobalStyle = createGlobalStyle`
  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Libre Baskerville', serif;
  }
`;


const App = () => {
    const { isDarkMode} = useDarkMode()

    return (
        <>
            <ThemeProvider theme={theme}>
                <GlobalStyle/>
                <AppContainer>
                    <Dashboard/>
                </AppContainer>
            </ThemeProvider>
        </>
    );
};

export default App;