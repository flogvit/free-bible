import React, {useState} from 'react';
import styled, {css} from 'styled-components';

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

const wordStyles = css`
    cursor: pointer;
    &:hover {
        text-decoration: underline;
    }
`;

const Word = styled.span`
    ${wordStyles}
    ${(props) =>
            props.isSelected &&
            css`
      background-color: yellow; /* Highlight color for selected word */
      border-radius: 3px;
    `}
`;

const Text = styled.span`
    /* Style for non-clickable text, if needed */
`;

const Explanation = styled.div`
  background: lightgrey;
  margin: 5px 0;
  padding: 5px;
`;

const OriginalWord = styled.span`
  font-style: italic;
  margin-right: 5px;
`;

const BibleVerse = ({ verse, verseNumber }) => {
    const [selectedWordId, setSelectedWordId] = useState(null);

    const verseWords = verse.text.split(/\s+/).map((word, index) => {
        const wordDetail = verse.words?.find(w => w.wordId - 1 === index);
        const isSelected = selectedWordId === wordDetail?.wordId;

        return (
            <React.Fragment key={index}>
                {wordDetail ? (
                    <Word
                        isSelected={isSelected}
                        onClick={() => setSelectedWordId(isSelected ? null : wordDetail.wordId)}
                    >
                        {word}
                    </Word>
                ) : (
                    <Text>{word}</Text>
                )}
                {' '}
            </React.Fragment>
        );
    });

    const selectedWordDetail = verse.words?.find(w => w.wordId === selectedWordId);

    return (
        <VerseWrapper>
            {verseNumber && <VerseNumber>{verse.verseId}</VerseNumber>}
            <div>{verseWords}</div>
            {selectedWordDetail && (
                <Explanation>
                    <OriginalWord>{selectedWordDetail.original}</OriginalWord>
                    {selectedWordDetail.explanation}
                </Explanation>
            )}
        </VerseWrapper>
    );
};

export default BibleVerse;