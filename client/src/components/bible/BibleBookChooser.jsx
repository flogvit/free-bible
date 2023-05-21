import React, {useMemo, useState} from 'react';
import styled, {useTheme} from 'styled-components';
import Select from "react-select";
import makeAnimated from 'react-select/animated';

const animatedComponents = makeAnimated();
const BookChooserContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 10px;

  > div {
    width: 100%;
  }

  > * {
    margin: 0 0 10px 0
  }


  button {
    cursor: pointer;
    border: none;
    padding: 9px;
    text-align: center;
    text-decoration: none;
    background-color: #e7e7e7;
    border-radius: 2px;
    margin: 1px;
    width: 38px;
    color: black;
  }
  button:disabled {
    background-color: white;
    color: black;
    cursor: not-allowed;
  }
  
  button:hover {
    opacity: 0.6;
  }
  
  button:focus {
    background-color: #a7a7a7;
  }
`;

const selectStyles = {
    control: (baseStyles, state) => ({
        ...baseStyles,
        borderColor: state.isFocused ? 'grey' : 'black',
    }),
        option: (styles, {data, isDisabled, isFocused, isSelected}) => {
        return {
            ...styles,
            backgroundColor: isDisabled ? 'grey' : 'white',
            color: '#000',
            cursor: isDisabled ? 'not-allowed' : 'default',
        };
    },
}

const BibleBookChooser = ({
                              translations,
                              onSelectTranslation,
                              onSelectBook,
                              onSelectChapter,
                              selectedTranslation,
                              selectedBook,
                              selectedChapter
                          }) => {
    const theme = useTheme();
    const handleTranslationChange = (selected) => {
        onSelectTranslation(selected);
    };

    const handleBookChange = (selected) => {
        onSelectBook(selected);
    };

    const handleChapterChange = (chapter) => {
        onSelectChapter(chapter);
    };

    const translationOptions = useMemo(() => {
        return Object.keys(translations).map(t => ({value: t, label: translations[t].short}));
    }, [translations]);

    const bookOptions = useMemo(() => {
        return selectedTranslation.length>0 ? translations[selectedTranslation[0].value].books.map(b => ({
            value: b.id,
            label: b.name
        })) : [];
    }, [translations, selectedTranslation]);

    const chapterCount = useMemo(() => {
        return selectedTranslation.length>0 && selectedBook ? translations[selectedTranslation[0].value].books.find(b => b.id === selectedBook.value).chapter_count : [];
    }, [selectedTranslation, selectedBook, translations]);

    const chapterArray = useMemo(() => {
        return Array.from(Array(chapterCount).keys()).map(k => k + 1)
    }, [chapterCount])

    return (
        <BookChooserContainer>
            <Select
                onChange={handleTranslationChange}
                closeMenuOnSelect={true}
                components={animatedComponents}
                defaultValue={selectedTranslation}
                isMulti
                options={translationOptions}
                styles={selectStyles}
            />
            {selectedTranslation.length>0 && (
                <Select
                    styles={selectStyles}
                    onChange={handleBookChange}
                    closeMenuOnSelect={true}
                    components={animatedComponents}
                    defaultValue={selectedBook}
                    options={bookOptions}
                />
            )}

            {selectedTranslation.length>0 && selectedBook && (
                <div>
                    {chapterArray.map((chapter) => (
                        <button
                            key={chapter}
                            onClick={() => handleChapterChange(chapter)}
                            disabled={selectedChapter === chapter}
                        >
                            {chapter}
                        </button>
                    ))}
                </div>
            )}

        </BookChooserContainer>
    );
};

export default BibleBookChooser;