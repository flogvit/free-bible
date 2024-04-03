import React, {useMemo, useState} from 'react';
import styled from 'styled-components';
import {getTranslationName, translations} from "../../library/translations.js";

const BibleNameWrapper = styled.div`
    font-style: italic;
    cursor: pointer;
`;

const InfoText = styled.div`
    background-color: #e2e2e2;
    margin-top: 10px;
    padding: 10px;
    border-left: 4px solid ${(props) => props.original ? '#a2a2a2' :'#0077cc'};
    font-size: 14px;
`;

const BibleName = ({translation}) => {
    const [showInfo, setShowInfo] = useState(false); // To track which translation's info to show

    const info = useMemo(() => {
        return translations[translation.value]
    }, [translation])

    return (
        <>
            <BibleNameWrapper onClick={() => setShowInfo(!showInfo)}>
                {info.name}
            </BibleNameWrapper>
            {showInfo && (
                <InfoText>
                    {info.info || 'Ingen ytterligere informasjon tilgjengelig.'}<br/>
                    {info.infoUrl &&
                        <a href={info.infoUrl} target="_blank" rel="noopener noreferrer">Mer info</a>}
                </InfoText>
            )}
        </>

    );
};

export default BibleName;
