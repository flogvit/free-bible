import React from 'react';
import styled from 'styled-components';

const VerseWrapper = styled.div`
  margin-bottom: 10px;
`;

const VerseNumber = styled.span`
  font-weight: bold;
  color: #FFA500;
  margin-right: 5px;
`;

const VerseText = styled.span`
  font-size: 18px;
  line-height: 1.5;
`;

const BibleVerse = ({ verse, verseNumber }) => {
    return (
        <VerseWrapper>
            {verseNumber && <VerseNumber>{verse.verseId}</VerseNumber>}
            <VerseText>{verse.text}</VerseText>
        </VerseWrapper>
    );
};

export default BibleVerse;