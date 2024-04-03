import React, {useState} from 'react';
import styled, {css} from 'styled-components';
import {getOriginalVerse, getRefText} from "./Translations.js";
import {useNavigate} from "react-router-dom";

const GotoButton = styled.button`
    margin-top: 10px;
    padding: 5px 10px;
    margin-right: 10px;
    background-color: #007bff;
    color: white;
    border: none;
    cursor: pointer;
    &:hover {
        background-color: #0056b3;
    }
`;

const ReferencesList = styled.ul`
    list-style-type: none;
    padding: 0;
`;

const ReferenceItem = styled.li`
    margin-bottom: 10px;
    cursor: pointer;
    border-left: 3px solid #007bff; /* Example highlight color */
    padding-left: 10px;
    &:hover {
        background-color: #f0f0f0; /* Light background on hover for interactivity */
    }
`;

const ReferenceText = styled.div`
    margin-top: 5px;
    padding: 5px;
    background-color: #e9ecef; /* Light background for the text content */
    border-radius: 5px;
    display: none; /* Initially hidden */
`;

const FadeTransition = styled.div`
    transition: opacity 0.3s, visibility 0.3s;
    opacity: ${props => props.show ? 1 : 0};
    visibility: ${props => props.show ? 'visible' : 'hidden'};
`;

const VerseWrapper = styled.div`
    display: flex;
    flex-direction: column;
    font-family: 'Roboto', sans-serif;
    padding-top: 5px;
`;


const VerseNumber = styled.span`
    font-weight: bold;
    color: #0077cc;
    cursor: pointer;
    user-select: none;
    margin-right: 5px;
    transition: color 0.3s, text-decoration-color 0.3s; /* Smooth transition for color and underline */

    &:hover {
        text-decoration: underline; /* Underline on hover for a subtler hint at interactivity */
        text-decoration-color: #0077cc; /* Ensure the underline is the same color as the text */
    }
`;

const VerseText = styled.span`
    font-size: 18px; /* Adjusted for better readability */
    line-height: 1.6;
    color: #333;
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
    background-color: #e2e2e2;
    margin-top: 10px;
    padding: 10px;
    border-left: 4px solid ${(props) => props.original ? '#a2a2a2' :'#0077cc'};
    font-size: 14px;
`;

const OriginalWord = styled.span`
    font-weight: bold;
    margin-right: 5px;
`;

const TabSelector = styled.div`
    display: flex;
    border-bottom: 2px solid #ddd;
`;

const TabButton = styled.button`
    flex: 1;
    padding: 10px 0; /* Adjust padding for better touch target size */
    border: none;
    background-color: ${(props) => (props.isActive ? '#f0f0f0' : 'transparent')};
    border-bottom: ${(props) => (props.isActive ? '3px solid #0077cc' : '3px solid transparent')};
    font-weight: ${(props) => (props.isActive ? 'bold' : 'normal')};
    cursor: pointer;
    font-size: 16px; /* Slightly larger font for tabs */

    &:hover {
        background-color: #f0f0f0;
    }
`;

const TabContent = styled.div`
    margin-bottom: 10px;
    background-color: #f0f0f0;
    
    ul {
        padding-top: 5px;
        padding-bottom: 1px;
        margin-block-start: 0em;
    }
`

const tabs = [
    {name: 'Original tekst'},
    {name: 'Referanser'}
];

const BibleVerse = ({verse, verseNumber}) => {
    const navigate = useNavigate();
    const [selectedWordId, setSelectedWordId] = useState(null);
    const [activeTabIndex, setActiveTabIndex] = useState(0); // null indicates no tab is active and selector is hidden
    const [showTabSelector, setShowTabSelector] = useState(false); // Manage visibility of the tab selector

    const toggleTabSelectorVisibility = () => {
        setShowTabSelector(!showTabSelector);
        // Optionally reset the active tab if you want to close the tabs when hiding the selector
        if (showTabSelector) setActiveTabIndex(0);
    };

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

    const [visibleRef, setVisibleRef] = useState(null); // Track the currently visible reference

    const toggleVisibility = (index) => {
        setVisibleRef(visibleRef === index ? null : index); // Toggle visibility for the clicked item
    };

    const goToReference = (reference) => {
        // Construct the URL with query parameters
        const queryParams = new URLSearchParams({
            book: reference.bookId,
            chapter: reference.chapterId,
            verseId: reference.fromVerseId,
            translations: 'osnb1' // Assuming a single translation for simplicity; adjust as needed
        }).toString();

        // Navigate to the constructed URL
        navigate(`?${queryParams}`, {replace: false});
    };

    const renderTabContent = () => {
        switch (activeTabIndex) {
            case 0:
                return <BibleVerse verse={getOriginalVerse(verse)} verseNumber={0}/>
            case 1:
                const references = verse?.references
                if (!references || references?.length === 0) return <div>Ingen referanser ennå</div>
                return <ReferencesList>
                    {references.map((reference, index) => (
                        <ReferenceItem key={index} onClick={() => toggleVisibility(index)}>
                            {getRefText(reference)}
                            {visibleRef === index && (
                                <ReferenceText style={{display: 'block'}}>
                                    <div>{reference.text}</div>
                                    <GotoButton onClick={() => goToReference(reference)}>Gå til</GotoButton>
                                </ReferenceText>
                            )}
                        </ReferenceItem>
                    ))}
                </ReferencesList>
            case 2:
                return <div>Ingen bønn ennå</div>;
            default:
                return null; // No tab selected
        }
    };

    return (
        <VerseWrapper>
            {verseNumber > 0 && (
                <VerseNumber onClick={toggleTabSelectorVisibility}>
                    {verse.verseId}
                </VerseNumber>
            )}
            {
                (showTabSelector &&
                    <FadeTransition show={showTabSelector}>
                        <TabSelector>
                            {tabs.map((tab, index) => (
                                <TabButton
                                    key={index}
                                    isActive={activeTabIndex === index}
                                    onClick={() => setActiveTabIndex(index)}
                                >
                                    {tab.name}
                                </TabButton>
                            ))}
                        </TabSelector>
                        <TabContent>
                            {renderTabContent()}
                        </TabContent>
                    </FadeTransition>
                )
            }
            <VerseText>{verseWords}</VerseText>
            <FadeTransition show={!!selectedWordDetail}>
                {selectedWordDetail && (
                    <Explanation original={"pronunciation" in selectedWordDetail}>
                        <OriginalWord>{selectedWordDetail.original}</OriginalWord>
                        <OriginalWord>{selectedWordDetail?.pronunciation}</OriginalWord>
                        {selectedWordDetail.explanation}
                    </Explanation>
                )}
            </FadeTransition>
        </VerseWrapper>
    )
};

export default BibleVerse;